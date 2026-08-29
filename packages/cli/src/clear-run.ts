/**
 * 清台挑战实验执行器（README 清台模式 / M6 起点）
 *
 * --agent synthetic:oracle  零成本验机（贪心选切角最小组合 + 最优角）
 * --agent llm              真模型（prompts/clear.yaml，c1 schema：选球-袋+瞄点+走位）
 * 输出：JSONL 研究日志（meta + 每杆 + summary）
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ClearSession, type ClearShotResult } from "@poolhall/core";
import { DEFAULT_BALL } from "@poolhall/engine";
import { LlmAgentSession } from "./llm.ts";
import { promptFingerprint } from "./prompt.ts";

export interface ClearRunOpts {
  agent: string;
  agentName: string;
  seed: number;
  maxShots: number;
  biasOverride?: number;
  out: string;
}

function log(out: string, obj: object): void {
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, `${JSON.stringify(obj)}\n`);
}

/** oracle 合成策略：切角最小组合 + ghost 最优角 + 固定中力（无走位智能——验机下界） */
function oracleIntent(session: ClearSession): { angle: number; power: number } {
  const obs = session.observe();
  const best = obs.aimAssists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const pk = obs.pockets.find((p) => p.id === best.pocket)!;
  const obj = obs.balls.find((b) => b.id === best.ball)!;
  const R = DEFAULT_BALL.R;
  const L = Math.hypot(pk.x - obj.x, pk.y - obj.y);
  const gx = obj.x + ((obj.x - pk.x) / L) * 2 * R;
  const gy = obj.y + ((obj.y - pk.y) / L) * 2 * R;
  return { angle: (Math.atan2(-(gy - cue.y), gx - cue.x) * 180) / Math.PI, power: 0.45 };
}

function stripShot(rec: ClearShotResult, extra: object): object {
  return {
    kind: "shot",
    shot: rec.shot,
    intentAngle: rec.intentAngle,
    pottedBalls: rec.pottedBalls,
    pottedPockets: rec.pottedPockets,
    scratch: rec.scratch,
    cueFinal: rec.cueFinal,
    finalBalls: rec.finalPos,
    continueTurn: rec.continueTurn,
    ...extra,
  };
}

export async function runClear(opts: ClearRunOpts): Promise<{
  agentName: string;
  seed: number;
  potted: number;
  total: number;
  shots: number;
  scratches: number;
  cleared: boolean;
}> {
  const isLlm = opts.agent === "llm";
  const session = new ClearSession({
    seed: opts.seed,
    agent: opts.agentName,
    maxShots: opts.maxShots,
    biasOverride: opts.biasOverride,
  });
  const llm = isLlm ? new LlmAgentSession(undefined, "clear") : null;

  log(opts.out, {
    kind: "meta",
    mode: "clear",
    agent: opts.agentName,
    spec: opts.agent,
    seed: opts.seed,
    maxShots: opts.maxShots,
    biasOverride: opts.biasOverride ?? null,
    prompt: isLlm ? promptFingerprint("clear") : null,
  });

  while (!session.finished) {
    const obs = session.observe();
    let intent: { angle: number; power: number; spin?: { x: number; y: number; z: number } };
    let extra: object = {};
    if (llm) {
      const d = await llm.shotClear(obs);
      if (!d) {
        console.error("[llm] 本局中断（连续调用失败）");
        break;
      }
      intent = { angle: d.angle, power: d.power, spin: d.spin };
      extra = {
        targetBall: d.targetBall,
        targetPocket: d.targetPocket,
        calibNote: llm.currentNote,
      };
    } else {
      intent = oracleIntent(session);
    }
    const rec = session.shoot(intent);
    log(opts.out, stripShot(rec, { ...extra, usage: llm?.lastUsage ?? null }));

    // 反馈：进袋给母球位；miss 给可读描述；scratch 终局提示
    if (llm) {
      if (rec.scratch) {
        llm.feedback(false, null, [], "母球进袋（scratch）", {
          trial: rec.shot,
          aim: { x: 0, y: 0 },
          angleUsed: rec.intentAngle,
          spinUsed: intent.spin ?? null,
          potted: false,
          pottedPocket: null,
          sideNote: "scratch",
        });
      } else if (rec.pottedBalls.length > 0) {
        const p = rec.pottedPockets[0]!;
        llm.feedback(true, p.pocket, rec.cueFinal ? [{ id: "cue", ...rec.cueFinal }] : [], null, {
          trial: rec.shot,
          aim: { x: 0, y: 0 },
          angleUsed: rec.intentAngle,
          spinUsed: intent.spin ?? null,
          potted: true,
          pottedPocket: p.pocket,
          sideNote: `球${p.ball}进袋`,
        });
      } else {
        // miss：目标球去向简述（AgentView 合规——只有结果观察）
        const target = (extra as { targetBall?: string }).targetBall;
        const fin = target ? rec.finalPos[target] : undefined;
        const desc = fin
          ? `目标球 ${target} 停在 (${fin.x.toFixed(3)}, ${fin.y.toFixed(3)})`
          : "未进";
        llm.feedback(false, null, [], desc, {
          trial: rec.shot,
          aim: { x: 0, y: 0 },
          angleUsed: rec.intentAngle,
          spinUsed: intent.spin ?? null,
          potted: false,
          pottedPocket: null,
          sideNote: null,
        });
      }
    }
  }

  const r = session.result();
  log(opts.out, {
    kind: "summary",
    ...r,
    usage: llm?.usageSummary() ?? null,
  });
  return { agentName: opts.agentName, seed: opts.seed, ...r };
}
