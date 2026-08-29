/**
 * 实验执行器（docs/benchmark.md / roadmap M3）
 *
 * --agent synthetic:oracle|no-comp|random   进程内合成 agent（零成本验机）
 * --agent llm                               走 Anthropic 兼容端点（真模型，会话式多轮）
 *
 * 输出：JSONL 研究日志（meta + 每杆三元组 + summary），出图交给 experiments/plot.py。
 * LLM 会话：observe(user) → shot(assistant) → 反馈(user，含横向偏差可读描述) → 下一杆。
 * 反馈只用 AgentView 字段（进没进/目标球终点/横向偏了多少球径），无 bias 提示（红线）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AgentObserve,
  biasAtShot,
  CalibSession,
  makeRandomStrategy,
  noCompStrategy,
  oracleStrategy,
  type ResearchShot,
  type Strategy,
} from "@poolhall/core";
import { DEFAULT_BALL } from "@poolhall/engine";
import { LlmAgentSession } from "./llm.ts";

const R = DEFAULT_BALL.R;

export interface RunOpts {
  /** "synthetic:oracle" | "synthetic:no-comp" | "synthetic:random" | "llm" */
  agent: string;
  /** 身份名（SQLite / 日志 key） */
  agentName: string;
  seed: number;
  trials: number;
  /** bias 对照：0 = bias 消除对照组；不传则用身份 bias */
  biasOverride?: number;
  out: string;
}

export interface RunSummary {
  agentName: string;
  seed: number;
  score: number;
  trials: number;
  log: string;
}

function pickStrategy(agent: string): {
  strategy: Strategy | null;
  isLlm: boolean;
  display: string;
} {
  if (agent.startsWith("synthetic:")) {
    const which = agent.slice("synthetic:".length);
    const map: Record<string, Strategy> = {
      oracle: oracleStrategy,
      "no-comp": noCompStrategy,
      random: makeRandomStrategy("synthetic-random"),
    };
    const s = map[which];
    if (!s) throw new Error(`无此合成 agent: ${which}（可用 oracle/no-comp/random）`);
    return { strategy: s, isLlm: false, display: `synthetic-${which}` };
  }
  if (agent === "llm") return { strategy: null, isLlm: true, display: "llm" };
  throw new Error(`未知 agent 规格: ${agent}`);
}

/** AgentView → 观察串（LLM 输入；字段即 AgentObserve 白名单） */
export function renderObserve(obs: AgentObserve): string {
  return JSON.stringify(obs);
}

function log(out: string, obj: object): void {
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, `${JSON.stringify(obj)}\n`);
}

function stripRec(r: ResearchShot): Record<string, unknown> {
  return {
    trial: r.trial,
    intentAngle: r.intent.angle,
    intentPower: r.intent.power,
    actualAngle: r.actual.angle,
    actualPower: r.actual.power,
    optimal: r.optimal,
    epsAngle: r.noise.epsAngle,
    biasAt: r.noise.biasAt,
    pot: r.pot,
    pottedPocket: r.pottedPocket,
    finalBalls: r.finalPos,
    samples: r.samples,
    events: r.events,
  };
}

/**
 * miss 偏差的球手可读渲染（AgentView 合规：只描述"结果"，绝不含 optimal/bias）。
 * 以"目标球初始位 → 袋心"连线为轴：垂向偏移（左/右，球径数）+ 沿轴差。
 */
function missNarrative(
  objInit: { x: number; y: number },
  pocket: { x: number; y: number },
  final: { x: number; y: number },
): string {
  const ux = pocket.x - objInit.x;
  const uy = pocket.y - objInit.y;
  const len = Math.hypot(ux, uy) || 1;
  const uxN = ux / len;
  const uyN = uy / len;
  const dx = final.x - objInit.x;
  const dy = final.y - objInit.y;
  const along = dx * uxN + dy * uyN;
  const side = dx * -uyN + dy * uxN; // >0 = 轴左侧（屏幕系）
  const balls = (m: number): string => `${(Math.abs(m) / (2 * R)).toFixed(1)} 球径`;
  return side > 0
    ? `横向偏左 ${balls(side)}，距袋心沿瞄准线还差 ${balls(len - along)}`
    : `横向偏右 ${balls(side)}，距袋心沿瞄准线还差 ${balls(len - along)}`;
}

/** 跑一整局；产出研究日志 */
export async function runCalibrate(opts: RunOpts): Promise<RunSummary> {
  const { strategy, isLlm, display } = pickStrategy(opts.agent);
  const session = new CalibSession({
    seed: opts.seed,
    agent: opts.agentName,
    trialCount: opts.trials,
    biasOverride: opts.biasOverride,
  });
  const llm = isLlm ? new LlmAgentSession() : null;

  log(opts.out, {
    kind: "meta",
    agent: opts.agentName,
    spec: opts.agent,
    display,
    seed: opts.seed,
    trials: opts.trials,
    biasOverride: opts.biasOverride ?? null,
  });

  while (!session.finished) {
    const obs = session.observe();
    let intent: { angle: number; power: number; spin?: { x: number; y: number; z: number } } | null;
    let _aimAt: { x: number; y: number } | null = null;
    if (llm) {
      const d = await llm.shot(obs);
      if (!d) {
        console.error("[llm] 本局中断（连续解析失败/调用失败）");
        break;
      }
      intent = { angle: d.angle, power: d.power, spin: d.spin };
      _aimAt = d.aimAt;
    } else {
      intent = strategy!(obs, {
        cuePos: session.currentLayout.cue.pos,
        objPos: session.currentLayout.obj.pos,
        pocketCenter: session.currentLayout.pocketCenter,
        R,
        bias: biasAtShot(session.hand, session.trial, session.seed, session.agent),
      });
    }
    // shoot 前缓存引用（shoot 后 layout 换下一 trial）；aimAt 由 LLM agent 返回
    const objInit = obs.balls.find((b) => b.id === "1") ?? { id: "1", x: 0, y: 0 };
    const pocketPt = obs.pockets.find((pk) => pk.id === obs.targetPocket) ?? { x: 0, y: 0 };

    const rec = session.shoot(intent);
    log(opts.out, {
      kind: "shot",
      seed: opts.seed,
      agent: opts.agentName,
      ...stripRec(rec),
      intentSpin: intent.spin ?? null,
      usage: llm?.lastUsage ?? null,
    });

    const objFinal = rec.finalPos["1"];
    const missDesc = !rec.pot && objFinal ? missNarrative(objInit, pocketPt, objFinal) : null;
    if (llm) {
      // v7 spin: ledger 记录 spinUsed；feedback 推下一杆的 prompt
      llm.feedback(
        rec.pot,
        rec.pottedPocket,
        Object.entries(rec.finalPos).map(([id, p]) => ({ id, ...p })),
        missDesc,
        {
          trial: rec.trial,
          aim: _aimAt ?? { x: 0, y: 0 },
          angleUsed: rec.intent.angle,
          spinUsed: intent.spin ?? null,
          potted: rec.pot,
          pottedPocket: rec.pottedPocket,
          sideNote: null,
        },
      );
    }
  }

  const r = session.result();
  log(opts.out, {
    kind: "summary",
    seed: opts.seed,
    agent: opts.agentName,
    score: r.score,
    trials: r.trialCount,
    usage: llm?.usageSummary() ?? null,
  });
  return {
    agentName: opts.agentName,
    seed: opts.seed,
    score: r.score,
    trials: r.trialCount,
    log: opts.out,
  };
}
