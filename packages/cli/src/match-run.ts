/**
 * 中式八球对局实验执行器（M6：Agent vs Agent）
 *
 * 选手规格：synthetic:oracle（贪心合法目标）或 llm（prompts/match.yaml，m1）
 * 两位选手各自 LlmAgentSession（记忆/笔记独立）+ 各自 hand model（bias 独立——
 * "读对手 bias"心理层的地基）。v1 反馈只发给击打方。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type MatchObserve,
  MatchSession,
  type MatchShotResult,
  type PlayerId,
} from "@poolhall/core";
import { DEFAULT_BALL } from "@poolhall/engine";
import type { Broadcast } from "./match-ws/server.ts";
import { LlmAgentSession } from "./llm.ts";
import { promptFingerprint } from "./prompt.ts";

export interface MatchRunOpts {
  /** 选手规格：synthetic:oracle | llm */
  specA: string;
  specB: string;
  nameA: string;
  nameB: string;
  seed: number;
  maxShots: number;
  out: string;
  /** B.实时对局可视化：每杆 broadcast 给 WS hub（可选） */
  hub?: { broadcast: (msg: Broadcast) => void };
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

export async function runMatch(opts: MatchRunOpts): Promise<{
  winner: PlayerId | null;
  reason: string | null;
  shots: number;
}> {
  const session = new MatchSession({
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

  while (!session.finished) {
    const obs: MatchObserve = session.observe();
    const isA = obs.turn === "A";
    const llm = isA ? llmA : llmB;
    let intent: { angle: number; power: number; spin?: { x: number; y: number; z: number } };
    let extra: object = {};
    if (llm) {
      const d = await llm.shotMatch(obs);
      if (!d) {
        console.error(`[llm] 选手 ${isA ? "A" : "B"} 连续调用失败，对局中断`);
        break;
      }
      intent = { angle: d.angle, power: d.power, spin: d.spin };
      extra = { targetBall: d.targetBall, targetPocket: d.targetPocket };
    } else {
      intent = oracleIntent(session);
      // oracle 路径无 targetBall/pocket（直接走 aimAssists 优选）—— 用 obs 取最优
      const obs0 = session.observe();
      const best0 = obs0.aimAssists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
      extra = { targetBall: best0.ball, targetPocket: best0.pocket };
    }
    const rec: MatchShotResult = session.shoot(intent);
    log(opts.out, {
      kind: "shot",
      shot: rec.shot,
      by: rec.byPlayer,
      ...extra,
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
      const extra2 = extra as { targetBall?: string; targetPocket?: string };
      opts.hub.broadcast({
        type: "shot",
        trial: rec.shot,
        by: rec.byPlayer,
        targetBall: extra2.targetBall ?? null,
        targetPocket: extra2.targetPocket ?? null,
        intentAngle: intent.angle,
        intentPower: intent.power,
        intentSpin: intent.spin ?? null,
        pottedBalls: rec.pottedBalls,
        pottedPockets: rec.pottedPockets,
        scratch: rec.scratch,
        firstContact: rec.firstContact,
        foul: rec.foul,
        nextTurn: rec.nextTurn,
        over: rec.over,
        winner: rec.winner,
        reason: rec.reason,
        cueFinal: rec.cueFinal,
        finalBalls: rec.finalPos,
        samples: rec.samples,
      });
    }

    // 反馈只给击打方（v1；观战视角后置）
    if (llm) {
      const desc = rec.foul
        ? rec.foul
        : rec.pottedBalls.length > 0
          ? null
          : missDescOf(rec, (extra as { targetBall?: string }).targetBall);
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
  }

  const r = session.result;
  log(opts.out, { kind: "summary", ...r });
  return r;
}

function missDescOf(rec: MatchShotResult, target: string | undefined): string {
  if (rec.scratch) return "母球进袋";
  if (rec.firstContact && target && rec.firstContact !== target) {
    return `首触到了 ${rec.firstContact}（非目标 ${target}）`;
  }
  const fin = target ? rec.finalPos[target] : undefined;
  return fin ? `目标球 ${target} 停在 (${fin.x.toFixed(3)}, ${fin.y.toFixed(3)})` : "未进";
}
