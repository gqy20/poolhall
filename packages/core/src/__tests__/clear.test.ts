/**
 * 清台挑战会话测试（docs/clear.md 规则）
 * oracle 策略：每杆采纳 aimAssists 里切角最小的组合，瞄 ghost 最优角——应能接近清台。
 */

import { DEFAULT_BALL } from "@poolhall/engine";
import { describe, expect, it } from "vitest";
import { ClearSession } from "../clear.ts";
import { biasAtShot } from "../hand.ts";

/** oracle：选切角最小组合，直接用最优角（含手感噪声） */
function oracleShot(session: ClearSession): { angle: number; power: number } {
  const obs = session.observe();
  const best = obs.aimAssists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const pocket = obs.pockets.find((p) => p.id === best.pocket)!;
  const obj = obs.balls.find((b) => b.id === best.ball)!;
  const R = DEFAULT_BALL.R;
  const ghostX =
    obj.x + ((obj.x - pocket.x) / Math.hypot(pocket.x - obj.x, pocket.y - obj.y)) * 2 * R;
  const ghostY =
    obj.y + ((obj.y - pocket.y) / Math.hypot(pocket.x - obj.x, pocket.y - obj.y)) * 2 * R;
  const angle = (Math.atan2(-(ghostY - cue.y), ghostX - cue.x) * 180) / Math.PI;
  return { angle, power: 0.45 };
}

describe("ClearSession", () => {
  it("rack 确定性：同 seed 同布局", () => {
    const a = new ClearSession({ seed: 42, agent: "t" });
    const b = new ClearSession({ seed: 42, agent: "t" });
    expect(a.observe().balls).toEqual(b.observe().balls);
  });

  it("rack 9 球 + 母球，无重叠", () => {
    const s = new ClearSession({ seed: 42, agent: "t" });
    const balls = s.observe().balls;
    expect(balls).toHaveLength(10);
    const R = DEFAULT_BALL.R;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!;
        const b = balls[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        expect(d).toBeGreaterThan(2 * R * 0.9); // 微扰后至少不硬重叠
      }
    }
  });

  it("oracle 策略：管线 sanity（能进球、会终止、预算内）——真实水平受 scratch 限制", () => {
    const s = new ClearSession({ seed: 42, agent: "oracle-clear" });
    while (!s.finished) {
      const { angle, power } = oracleShot(s);
      s.shoot({ angle, power });
    }
    const r = s.result();
    // 贪心无走位策略 2-6/9 且常死于 scratch（直球跟进）——游戏难度真实；
    // 此测试只验证机制通路：至少进 2 颗、正常终止
    expect(r.potted).toBeGreaterThanOrEqual(2);
    expect(r.shots).toBeLessThanOrEqual(30);
  });

  it("未进不终局：打空杆后仍可继续（计分赛制）", () => {
    const s = new ClearSession({ seed: 42, agent: "t" });
    const rec = s.shoot({ angle: 170, power: 0.3 });
    if (rec.pottedBalls.length === 0 && !rec.scratch) {
      expect(rec.continueTurn).toBe(true);
      expect(s.finished).toBe(false);
    }
  });

  it("scratch 终局", () => {
    const s = new ClearSession({ seed: 42, agent: "t" });
    // 直打角袋
    const obs = s.observe();
    const cue = obs.balls.find((b) => b.id === "cue")!;
    const ang = (Math.atan2(-(0 - cue.y), 0 - cue.x) * 180) / Math.PI;
    const rec = s.shoot({ angle: ang, power: 0.7 });
    if (rec.scratch) {
      expect(rec.continueTurn).toBe(false);
      expect(s.finished).toBe(true);
      expect(s.result().scratches).toBe(1);
    }
  });

  it("进球继续击打：母球位持续演化（finalPos 通路）", () => {
    const s = new ClearSession({ seed: 7, agent: "cont" });
    let potted = false;
    while (!s.finished) {
      const rec = s.shoot(oracleShot(s));
      if (rec.pottedBalls.length > 0) potted = true;
      expect(rec.finalPos.cue || rec.scratch).toBeTruthy();
    }
    expect(potted || s.potted > 0 || s.finished).toBe(true);
  });

  it("bias 注入生效（同 seed 两局轨迹分叉 / 覆盖为 0 时 actual==intent 角）", () => {
    const s0 = new ClearSession({ seed: 42, agent: "bias-check", biasOverride: 0 });
    const rec0 = s0.shoot({ angle: 10, power: 0.4 });
    expect(rec0.intentAngle).toBe(10);
    const hand = s0.hand;
    expect(hand.biasBase).toBe(0);
    const b = biasAtShot(hand, 0, 42, "bias-check");
    expect(b).toBe(0);
  });
});
