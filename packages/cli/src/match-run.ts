/**
 * 中式八球对局实验执行器（M6：Agent vs Agent）
 *
 * 选手规格：synthetic:oracle（贪心合法目标）/ llm（prompts/match.yaml，m1）/
 * external（外部 Agent 经 HTTP 入座，M6.3）。两位选手各自 hand model
 * （bias 独立——“读对手 bias”心理层的地基）。v1 反馈只发给击打方。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  compactMatchSamples,
  MATCH_EVENT_SCHEMA,
  type MatchEvent,
  type MatchObserve,
  type MatchPublicPlan,
  MatchSession,
  type MatchShotResult,
  type PlayerId,
} from "@poolhall/core";
import { DEFAULT_BALL } from "@poolhall/engine";
import { LlmAgentSession } from "./llm.ts";
import type { ShotWait } from "./match-http.ts";
import { promptFingerprint } from "./prompt.ts";

export interface MatchRunOpts {
  /** 选手规格：synthetic:oracle | llm | external */
  specA: string;
  specB: string;
  nameA: string;
  nameB: string;
  seed: number;
  maxShots: number;
  out: string;
  /** 共享对局模式：复用调用方创建的会话（web-match 外部接入）；缺省自建 */
  session?: MatchSession;
  /** 外部选手出杆来源（spec=external 必供）：超时返回 {kind:"timeout"} */
  externalShot?: (player: PlayerId, obs: MatchObserve) => Promise<ShotWait>;
  /** B.实时对局可视化：每杆 broadcast 给 WS hub（可选） */
  hub?: { broadcast: (event: MatchEvent) => void };
  /** 实时观战节奏：本杆广播后，下一次 Agent 决策前等待。 */
  paceShot?: (result: MatchShotResult) => Promise<void>;
  shouldStop?: () => boolean;
  onThinking?: (player: PlayerId) => void;
}

function log(out: string, obj: object): void {
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, `${JSON.stringify(obj)}\n`);
}

/** oracle：合法目标里选切角最小组合，瞄 ghost（与测试同款） */
function oracleIntent(session: MatchSession): { angle: number; power: number } {
  const obs = session.observe();
  const legal = new Set(
    obs.yourGroup === "solids"
      ? obs.balls.filter((b) => Number(b.id) <= 7).map((b) => b.id)
      : obs.yourGroup === "stripes"
        ? obs.balls.filter((b) => Number(b.id) >= 9).map((b) => b.id)
        : obs.balls.filter((b) => b.id !== "cue" && b.id !== "8").map((b) => b.id),
  );
  const hasOwn = obs.yourGroup !== "open" && legal.size > 0;
  const cands = obs.aimAssists.filter((a) => (hasOwn ? legal.has(a.ball) : a.ball !== "8"));
  const eight = obs.aimAssists.find((a) => a.ball === "8");
  const pool = cands.length > 0 ? cands : eight ? [eight] : obs.aimAssists;
  const best = pool.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const angle = (Math.atan2(-(best.ghost.y - cue.y), best.ghost.x - cue.x) * 180) / Math.PI;
  return { angle, power: 0.45 };
}

function oraclePlan(obs: MatchObserve, target: string, pocket: string | null): MatchPublicPlan {
  const assist = obs.aimAssists.find((item) => item.ball === target && item.pocket === pocket);
  const cut = assist?.cutAngleDeg ?? 0;
  return {
    observation: obs.breakShot
      ? "球组已摆紧，母球位于开球线后，当前执行标准开球"
      : `当前为${obs.yourGroup === "open" ? "开放球局" : obs.yourGroup === "solids" ? "全色组" : "花色组"}，优先寻找低切角组合`,
    choice: pocket
      ? `选择 ${target} 号球进 ${pocket} 袋，切角约 ${cut.toFixed(1)}°`
      : "直击 1 号顶球冲散球组",
    cuePlan: obs.breakShot ? "使用较高力度沿长轴开球" : "使用中等力度，尽量保留母球在中区",
    risk: obs.breakShot ? "主要风险是母球进袋或不足四球碰库" : "主要风险是母球跟进或首触偏离目标球",
    confidence: cut < 20 ? "high" : cut < 45 ? "medium" : "low",
  };
}

export async function runMatch(opts: MatchRunOpts): Promise<{
  winner: PlayerId | null;
  reason: string | null;
  shots: number;
}> {
  const session =
    opts.session ??
    new MatchSession({
      seed: opts.seed,
      nameA: opts.nameA,
      nameB: opts.nameB,
      maxShots: opts.maxShots,
    });
  const mkPlayer = (spec: string) =>
    spec === "llm" ? new LlmAgentSession(undefined, "match") : null;
  const llmA = mkPlayer(opts.specA);
  const llmB = mkPlayer(opts.specB);
  void DEFAULT_BALL;

  log(opts.out, {
    kind: "meta",
    mode: "match",
    seed: opts.seed,
    nameA: opts.nameA,
    specA: opts.specA,
    nameB: opts.nameB,
    specB: opts.specB,
    maxShots: opts.maxShots,
    promptA: llmA ? promptFingerprint("match") : null,
    promptB: llmB ? promptFingerprint("match") : null,
  });

  while (!session.finished && !opts.shouldStop?.()) {
    const obs: MatchObserve = session.observe();
    const isA = obs.turn === "A";
    const llm = isA ? llmA : llmB;
    opts.onThinking?.(obs.turn);
    let intent: { angle: number; power: number; spin?: { x: number; y: number; z: number } };
    let extra: { targetBall?: string; targetPocket?: string | null } = {};
    let publicPlan: MatchPublicPlan;
    let prediction: string | null = null;
    const spec = isA ? opts.specA : opts.specB;
    if (spec === "external") {
      const external = await externalDecision(opts, session, obs);
      if (external === "abort") break;
      intent = external.intent;
      extra = { targetBall: external.targetBall, targetPocket: external.targetPocket };
      publicPlan = external.plan ?? externalPlan(external.prediction);
      prediction = external.prediction;
    } else if (obs.breakShot) {
      intent = session.breakIntent();
      extra = { targetBall: "1", targetPocket: null };
      publicPlan = oraclePlan(obs, "1", null);
    } else if (llm) {
      const d = await llm.shotMatch(obs);
      if (!d) {
        console.error(`[llm] 选手 ${isA ? "A" : "B"} 连续调用失败，对局中断`);
        break;
      }
      intent = { angle: d.angle, power: d.power, spin: d.spin };
      extra = { targetBall: d.targetBall, targetPocket: d.targetPocket };
      publicPlan = d.publicPlan;
    } else {
      intent = oracleIntent(session);
      // oracle 路径无 targetBall/pocket（直接走 aimAssists 优选）—— 用 obs 取最优
      const obs0 = session.observe();
      const best0 = obs0.aimAssists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
      extra = { targetBall: best0.ball, targetPocket: best0.pocket };
      publicPlan = oraclePlan(obs, best0.ball, best0.pocket);
    }
    const rec: MatchShotResult = session.shoot(intent);
    log(opts.out, {
      kind: "shot",
      shot: rec.shot,
      by: rec.byPlayer,
      ...extra,
      prediction,
      pottedBalls: rec.pottedBalls,
      scratch: rec.scratch,
      firstContact: rec.firstContact,
      foul: rec.foul,
      nextTurn: rec.nextTurn,
      over: rec.over,
      finalBalls: rec.finalPos,
    });

    // B.实时对局可视化：每杆 broadcast
    if (opts.hub) {
      opts.hub.broadcast({
        type: "shot",
        schema: MATCH_EVENT_SCHEMA,
        trial: rec.shot,
        by: rec.byPlayer,
        targetBall: extra.targetBall ?? null,
        targetPocket: extra.targetPocket ?? null,
        intentAngle: intent.angle,
        intentPower: intent.power,
        intentSpin: intent.spin ?? null,
        publicPlan,
        review: reviewOf(rec, extra.targetBall),
        pottedBalls: rec.pottedBalls,
        pottedPockets: rec.pottedPockets,
        scratch: rec.scratch,
        firstContact: rec.firstContact,
        cueHeading: cueHeadingOf(rec.samples),
        foul: rec.foul,
        nextTurn: rec.nextTurn,
        over: rec.over,
        winner: rec.winner,
        reason: rec.reason,
        sampleMode: "delta-v1",
        cueFinal: rec.cueFinal,
        finalBalls: rec.finalPos,
        samples: compactMatchSamples(rec.samples),
      });
    }

    // 反馈只给击打方（v1；观战视角后置）
    if (llm && !obs.breakShot) {
      const desc = rec.foul
        ? rec.foul
        : rec.pottedBalls.length > 0
          ? null
          : missDescOf(rec, extra.targetBall);
      llm.feedback(
        !rec.foul && rec.pottedBalls.length > 0,
        rec.pottedPockets[0]?.pocket ?? null,
        [],
        desc,
        {
          trial: rec.shot,
          aim: { x: 0, y: 0 },
          angleUsed: intent.angle,
          spinUsed: intent.spin ?? null,
          potted: rec.pottedBalls.length > 0,
          pottedPocket: rec.pottedPockets[0]?.pocket ?? null,
          sideNote: null,
        },
      );
    }
    await opts.paceShot?.(rec);
  }

  const r = session.result;
  log(opts.out, { kind: "summary", ...r });
  return r;
}

/** 母球初始出射角（可观测物理量）：轨迹中首个母球 ≥3cm 位移帧，出杆角约定；
 *  与 intentAngle 之差 = 本杆注入（bias+ε）——读人信号；未动/无轨迹 → null */
function cueHeadingOf(
  samples: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>,
): number | null {
  const first = samples[0]?.pos["cue"];
  if (!first) return null;
  for (const s of samples) {
    const p = s.pos["cue"];
    if (!p) return null;
    const dx = p.x - first.x;
    const dy = p.y - first.y;
    if (Math.hypot(dx, dy) >= 0.03) return (Math.atan2(-dy, dx) * 180) / Math.PI;
  }
  return null;
}

function reviewOf(rec: MatchShotResult, target: string | undefined): string {
  if (rec.foul) return `计划未完成：${rec.foul}`;
  if (rec.pottedBalls.length > 0) return `计划结果：进袋 ${rec.pottedBalls.join("、")} 号球`;
  return `计划未命中：${missDescOf(rec, target)}`;
}

/** 外部选手一杆：等 HTTP 出杆，超时则判负；进程被打断时返回 "abort" */
async function externalDecision(
  opts: MatchRunOpts,
  session: MatchSession,
  obs: MatchObserve,
): Promise<
  | "abort"
  | {
      intent: { angle: number; power: number; spin?: { x: number; y: number; z: number } };
      targetBall: string;
      targetPocket: string;
      prediction: string | null;
      plan: MatchPublicPlan | null;
    }
> {
  if (!opts.externalShot) throw new Error("spec=external 必须提供 externalShot 回调");
  const wait = await opts.externalShot(obs.turn, obs);
  if (wait.kind === "timeout") {
    if (!opts.shouldStop?.()) {
      const loser = obs.turn === "A" ? opts.nameA : opts.nameB;
      session.resign(obs.turn, `${loser} 出杆超时——判负`);
    }
    return "abort";
  }
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const angle = (Math.atan2(-(wait.shot.aimY - cue.y), wait.shot.aimX - cue.x) * 180) / Math.PI;
  return {
    intent: { angle, power: wait.shot.power, spin: wait.shot.spin },
    targetBall: wait.shot.targetBall,
    targetPocket: wait.shot.targetPocket,
    prediction: wait.shot.prediction ?? null,
    plan: wait.shot.plan ?? null,
  };
}

/** 外部选手的公开计划：预测文本即叙事，缺省占位 */
function externalPlan(prediction: string | null): MatchPublicPlan {
  const text = (prediction ?? "").trim() || "外部选手通过 MCP 接入本桌";
  return {
    observation: text.slice(0, 160),
    choice: "外部选手出杆（详见观察摘要）",
    cuePlan: "由外部选手自行决定",
    risk: "由外部选手自行评估",
    confidence: "medium",
  };
}

function missDescOf(rec: MatchShotResult, target: string | undefined): string {
  if (rec.scratch) return "母球进袋";
  if (rec.firstContact && target && rec.firstContact !== target) {
    return `首触到了 ${rec.firstContact}（非目标 ${target}）`;
  }
  const fin = target ? rec.finalPos[target] : undefined;
  return fin ? `目标球 ${target} 停在 (${fin.x.toFixed(3)}, ${fin.y.toFixed(3)})` : "未进";
}
