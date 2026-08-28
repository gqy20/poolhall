/**
 * 实验执行器（docs/benchmark.md / roadmap M3）
 *
 * --agent synthetic:oracle|no-comp|random   进程内合成 agent（零成本验机）
 * --agent llm                               走 Anthropic 兼容端点（真模型，会话式多轮）
 *
 * 输出：JSONL 研究日志（meta + 每杆三元组 + summary），出图交给 experiments/plot。
 * LLM 会话构成：observe(user) → shot(assistant) → feedback+下杆 observe(user)…
 * 反馈只用 AgentView 字段（进球与否/目标球终点），无 bias 提示（docs/hand-model.md §6）。
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
  /** 身份名（SQLite / 日志 key；llm 时建议带模型名） */
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

/** AgentView → 观察串（LLM 输入用；字段即 AgentObserve 白名单） */
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
  };
}

/** 跑一整局：合成 agent 零成本 / llm 会话式多轮；产出研究日志 */
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
    let intent: { angle: number; power: number } | null;
    if (llm) {
      intent = await llm.shot(obs);
      if (!intent) {
        console.error("[llm] 本局中断（连续解析失败/调用失败）");
        break;
      }
    } else {
      intent = strategy!(obs, {
        cuePos: session.currentLayout.cue.pos,
        objPos: session.currentLayout.obj.pos,
        pocketCenter: session.currentLayout.pocketCenter,
        R,
        bias: biasAtShot(session.hand, session.trial, session.seed, session.agent),
      });
    }
    const rec = session.shoot(intent);
    log(opts.out, { kind: "shot", seed: opts.seed, agent: opts.agentName, ...stripRec(rec) });
    llm?.feedback(
      rec.pot,
      rec.pottedPocket,
      Object.entries(rec.finalPos).map(([id, p]) => ({ id, ...p })),
    );
  }

  const r = session.result();
  log(opts.out, {
    kind: "summary",
    seed: opts.seed,
    agent: opts.agentName,
    score: r.score,
    trials: r.trialCount,
  });
  return {
    agentName: opts.agentName,
    seed: opts.seed,
    score: r.score,
    trials: r.trialCount,
    log: opts.out,
  };
}
