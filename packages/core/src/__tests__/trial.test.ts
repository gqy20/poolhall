import { DEFAULT_BALL } from "@poolhall/engine";
import { describe, expect, it } from "vitest";
import { noCompStrategy, oracleStrategy } from "../agents.ts";
import { biasAtShot } from "../hand.ts";
import { CalibSession } from "../trial.ts";

const R = DEFAULT_BALL.R;

describe("trial 布局约束（docs/benchmark.md §1）", () => {
  it("100 个 trial 全部满足：距袋/距离/切角/台内", () => {
    for (const seed of [1, 42, 777]) {
      const s = new CalibSession({ seed, agent: "layout-check", trialCount: 20 });
      for (let i = 0; i < 20; i++) {
        const L = s.currentLayout;
        expect(L.objDist).toBeGreaterThanOrEqual(0.5);
        expect(L.objDist).toBeLessThanOrEqual(1.0);
        expect(L.cutAngle).toBeLessThanOrEqual(25.0001);
        // 母球到目标球 0.4–0.9m（切角带 ±8° 抖动不改距离）
        const d = L.cue.pos;
        const cb = Math.hypot(d.x - L.obj.pos.x, d.y - L.obj.pos.y);
        expect(cb).toBeGreaterThanOrEqual(0.3 - 1e-9);
        expect(cb).toBeLessThanOrEqual(0.7 + 1e-9);
        expect(cb).toBeGreaterThanOrEqual(2 * R + 1e-6);
        // 两球都在台内
        for (const b of [L.cue.pos, L.obj.pos]) {
          expect(b.x).toBeGreaterThan(0);
          expect(b.x).toBeLessThan(2);
          expect(b.y).toBeGreaterThan(0);
          expect(b.y).toBeLessThan(1);
        }
        s.shoot({ angle: 0, power: 0.3 });
      }
    }
  });

  it("同 (seed, agent) 同布局；推进 trial / 换 seed 后布局变", () => {
    const s1 = new CalibSession({ seed: 9, agent: "x" });
    const s2 = new CalibSession({ seed: 9, agent: "x" });
    expect(s2.currentLayout.cue.pos).toEqual(s1.currentLayout.cue.pos);
    s2.shoot({ angle: 0, power: 0.3 });
    expect(s2.currentLayout.cue.pos).not.toEqual(s1.currentLayout.cue.pos);
    const s4 = new CalibSession({ seed: 10, agent: "x" });
    const same =
      s4.currentLayout.cue.pos.x === s1.currentLayout.cue.pos.x &&
      s4.currentLayout.cue.pos.y === s1.currentLayout.cue.pos.y &&
      s4.currentLayout.obj.pos.x === s1.currentLayout.obj.pos.x;
    expect(same).toBe(false);
  });
});

/** DoD：oracle 合成 agent 稳定 90%+ 进球率（多组 seed×agent，docs/benchmark.md §5） */
const SEEDS: Record<string, number> = {
  "oracle-a": 1,
  "oracle-b": 42,
  "oracle-c": 777,
  "oracle-d": 31337,
  "oracle-e": 2024,
};
const agentSeed = (agent: string): number => SEEDS[agent] ?? 42;

describe("oracle 验机（M2 DoD）", () => {
  const _runOracle = (agent: string, trials: number): { pots: number; score: number } => {
    const sess = new CalibSession({ seed: agentSeed(agent), agent, trialCount: trials });
    while (!s_finished(sess)) {
      const L = sess.currentLayout;
      const info = {
        cuePos: L.cue.pos,
        objPos: L.obj.pos,
        pocketCenter: L.pocketCenter,
        R,
        // oracle 偷看当前杆 bias（含漂移）
        bias: biasAtShot(sess.hand, sess.trial, sess.seed, sess.agent),
      };
      const d = oracleStrategy(
        {
          kind: "observe",
          trial: 0,
          trialCount: trials,
          score: 0,
          targetPocket: L.pocketId,
          balls: [],
        },
        info,
      );
      s_shoot(sess, d);
    }
    const r = sess.result();
    return { pots: r.score, score: r.score };
  };

  it("oracle × 5 组 identity：每组 20 杆进球率 ≥ 90%", { timeout: 240000 }, () => {
    const combos: Array<[number, string]> = [
      [1, "oracle-a"],
      [42, "oracle-b"],
      [777, "oracle-c"],
      [31337, "oracle-d"],
      [2024, "oracle-e"],
    ];
    for (const [seed, agent] of combos) {
      const s = new CalibSession({ seed, agent, trialCount: 20 });
      while (!s.finished) {
        const L = s.currentLayout;
        const bias = biasAtShot(s.hand, s.trial, s.seed, s.agent);
        const d = oracleStrategy(
          {
            kind: "observe",
            trial: s.trial,
            trialCount: s.trialCount,
            score: s.result().score,
            targetPocket: L.pocketId,
            balls: [],
          },
          { cuePos: L.cue.pos, objPos: L.obj.pos, pocketCenter: L.pocketCenter, R, bias },
        );
        s.shoot(d);
      }
      const r = s.result();
      const rate = r.score / r.trialCount;
      expect(r.score).toBeGreaterThanOrEqual(0.9 * 20 - 2); // 容忍 2 杆脱靶（≈95%）
      expect(rate).toBeGreaterThan(0.8);
    }
  });

  it("no-comp 对照：bias≠0 时进球率明显低于 oracle", () => {
    const s = new CalibSession({ seed: 42, agent: "no-comp-x", trialCount: 20, biasOverride: 1.5 });
    while (!s.finished) {
      const L = s.currentLayout;
      const d = noCompStrategy(
        {
          kind: "observe",
          trial: 0,
          trialCount: 20,
          score: 0,
          targetPocket: L.pocketId,
          balls: [],
        },
        { cuePos: L.cue.pos, objPos: L.obj.pos, pocketCenter: L.pocketCenter, R, bias: 0 },
      );
      s.shoot(d);
    }
    const r = s.result();
    // bias=1.5° 时无补偿系统偏差会让大部分中远台球脱袋（机器自检：注入确实生效）
    expect(r.score).toBeLessThan(0.9 * 20);
  });
});

function s_finished(s: CalibSession): boolean {
  return s.finished;
}
function s_shoot(s: CalibSession, d: { angle: number; power: number }): void {
  s.shoot(d);
}
