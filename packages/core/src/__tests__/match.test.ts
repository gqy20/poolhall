/**
 * 中式八球对局测试（docs/match.md v1 规则）
 */
import { DEFAULT_BALL } from "@poolhall/engine";
import { describe, expect, it } from "vitest";
import { BREAK_LINE_X, FOOT_SPOT_X, MATCH_TABLE, MatchSession } from "../match.ts";

/** oracle：选切角最小的【合法】目标组合，瞄 ghost */
function oracleShot(session: MatchSession): { angle: number; power: number } {
  if (session.observe().breakShot) return session.breakIntent();
  const obs = session.observe();
  const legal = new Set(
    obs.yourGroup === "solids"
      ? obs.balls.filter((b) => Number(b.id) <= 7).map((b) => b.id)
      : obs.yourGroup === "stripes"
        ? obs.balls.filter((b) => Number(b.id) >= 9).map((b) => b.id)
        : obs.balls.filter((b) => b.id !== "cue" && b.id !== "8").map((b) => b.id),
  );
  // 本组清空后打 8
  const hasOwn = obs.yourGroup !== "open" && legal.size > 0;
  const cands = obs.aimAssists.filter((a) => (hasOwn ? legal.has(a.ball) : a.ball !== "8"));
  const eight = obs.aimAssists.find((a) => a.ball === "8");
  const pool = cands.length > 0 ? cands : eight ? [eight] : obs.aimAssists;
  const best = pool.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const angle = (Math.atan2(-(best.ghost.y - cue.y), best.ghost.x - cue.x) * 180) / Math.PI;
  return { angle, power: 0.45 };
}

describe("MatchSession", () => {
  it("rack：16 球、1 顶点、8 第三行中位、底角一全一花、无重叠", () => {
    const s = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    const balls = s.observe().balls;
    expect(balls).toHaveLength(16);
    const R = DEFAULT_BALL.R;
    const cue = balls.find((b) => b.id === "cue")!;
    const one = balls.find((b) => b.id === "1")!;
    const eight = balls.find((b) => b.id === "8")!;
    expect(MATCH_TABLE).toMatchObject({ width: 2.54, height: 1.27 });
    expect(cue.x).toBeLessThan(BREAK_LINE_X);
    expect(cue.y).toBeCloseTo(MATCH_TABLE.height / 2, 8);
    expect(one.x).toBeCloseTo(FOOT_SPOT_X, 8);
    expect(one.y).toBeCloseTo(MATCH_TABLE.height / 2, 8);
    expect(eight.x).toBeGreaterThan(one.x);
    expect(eight.y).toBeCloseTo(MATCH_TABLE.height / 2, 8);
    const num = balls.filter((b) => b.id !== "cue");
    for (let i = 0; i < num.length; i++) {
      for (let j = i + 1; j < num.length; j++) {
        const d = Math.hypot(num[i]!.x - num[j]!.x, num[i]!.y - num[j]!.y);
        expect(d).toBeGreaterThan(2 * R * 0.9);
      }
    }
    // 确定性
    const s2 = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    expect(s2.observe().balls).toEqual(balls);
  });

  it("开球：沿长轴首触顶球，合法开球后保持开放台", () => {
    const s = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    expect(s.observe().breakShot).toBe(true);
    expect(s.breakIntent()).toEqual({ angle: 0, power: 0.85 });
    const rec = s.shoot(s.breakIntent());
    expect(rec.firstContact).toBe("1");
    expect(rec.foul).toBeNull();
    expect(s.groups).toEqual({ A: "open", B: "open" });
    expect(s.observe().breakShot).toBe(false);
  });

  it("open table：首个合法进球定组", () => {
    const s = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    expect(s.groups.A).toBe("open");
    // 打到进球为止，然后检查定组一致性
    let guard = 0;
    while (!s.finished && s.groups.A === "open" && guard++ < 30) {
      s.shoot(oracleShot(s));
    }
    if (s.groups.A !== "open") {
      expect(s.groups.B).not.toBe("open");
      expect(s.groups.A).not.toBe(s.groups.B);
    }
  });

  it("换手：未进自己组的球轮到对方", () => {
    const s = new MatchSession({ seed: 7, nameA: "a", nameB: "b" });
    const before = s.currentTurn;
    // 空杆
    const rec = s.shoot({ angle: 178, power: 0.2 });
    if (!rec.foul && rec.pottedBalls.length === 0) {
      expect(s.currentTurn).not.toBe(before);
    }
  });

  it("双 oracle 完整对局：60 杆内正常终局（胜/负/平局皆可，不崩不挂）", () => {
    const s = new MatchSession({ seed: 42, nameA: "oracleA", nameB: "oracleB" });
    while (!s.finished) {
      s.shoot(oracleShot(s));
    }
    const r = s.result;
    expect(r.shots).toBeLessThanOrEqual(60);
    // 打印性断言：胜利时必须有 reason
    if (r.winner !== null) expect(r.reason).toBeTruthy();
  });

  it("双选手手感独立（hand model 各自派生）", () => {
    const s = new MatchSession({ seed: 42, nameA: "playerX", nameB: "playerY" });
    expect(s.handA).not.toEqual(s.handB);
  });

  it("handSeed：不同对局 seed 下 bias 恒定（跨局肌肉记忆）", () => {
    const s1 = new MatchSession({ seed: 1, handSeed: 42, nameA: "alice", nameB: "bob" });
    const s2 = new MatchSession({ seed: 99, handSeed: 42, nameA: "alice", nameB: "bob" });
    expect(s1.handA.biasBase).toBe(s2.handA.biasBase);
    expect(s1.handB.biasBase).toBe(s2.handB.biasBase);
    const s3 = new MatchSession({ seed: 1, handSeed: 43, nameA: "alice", nameB: "bob" });
    expect(s3.handA.biasBase).not.toBe(s1.handA.biasBase);
  });

  it("resign：中途认负 → 对手获胜，对局立即终止", () => {
    const s = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    s.resign("A", "a 出杆超时——判负");
    expect(s.finished).toBe(true);
    expect(s.result.winner).toBe("B");
    expect(s.result.reason).toBe("a 出杆超时——判负");
    expect(() => s.shoot({ angle: 0, power: 0.5 })).toThrow("对局已结束");
  });

  it("resign：终局后重复认负不改变结果", () => {
    const s = new MatchSession({ seed: 42, nameA: "a", nameB: "b" });
    s.resign("A", "第一次判负");
    s.resign("B", "第二次不应生效");
    expect(s.result.winner).toBe("B");
    expect(s.result.reason).toBe("第一次判负");
  });
});
