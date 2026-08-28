/**
 * v1 spin 测试（docs/physics.md §3 v1 解冻范围）
 *
 * v1 解冻范围（最小诚实版）：
 *   - spinning 状态机：v≈0 且 ω_z≠0 时纯自转衰减
 *   - strike 接受 spin ∈ [-1,1]^3 输入
 *
 * v1 未解冻（v2 范畴）：
 *   - 球-球 throw（spin 转化为 vel 切向分量）→ 高低杆涌现
 *   - 库边切向 spin（加塞）→ 旋球涌现
 *
 * 物理上，spin x/y 注入会被 sliding 卷向自然滚动 + rolling lockRoll 强制锁回；
 * spin z 注入能在 v≈0 后看到 ω_z 持续衰减一段时间（spinning 分支）。
 */

import { describe, expect, it } from "vitest";
import { makeBall, strike } from "../ball.ts";
import { DEFAULT_BALL, SIM, SPIN_SCALE } from "../consts.ts";
import { integrateAll } from "../physics.ts";
import { simulate } from "../simulate.ts";
import { buildTable } from "../table.ts";
import { vec2 } from "../vec2.ts";

const table = buildTable();
const p = DEFAULT_BALL;

describe("v1 spin · spinning 衰减", () => {
  it("spin=0 strike：ω 起步全 0（向后兼容 v0）", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    strike(b, 0, 0.5);
    expect(b.w.x).toBe(0);
    expect(b.w.y).toBe(0);
    expect(b.w.z).toBe(0);
  });

  it("spin (1, 0, 0) strike：ω_x = SPIN_SCALE，ω_y/ω_z = 0", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    strike(b, 0, 0.5, { x: 1, y: 0, z: 0 });
    expect(b.w.x).toBe(SPIN_SCALE);
    expect(b.w.y).toBe(0);
    expect(b.w.z).toBe(0);
  });

  it("spin (0, 0, 1) 加塞：ω_z = SPIN_SCALE", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    strike(b, 0, 0.5, { x: 0, y: 0, z: 1 });
    expect(b.w.z).toBe(SPIN_SCALE);
  });

  it("spinning 衰减：v≈0 + ω_z=30 rad/s 单调下降到 0", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    b.w.z = SPIN_SCALE; // 起步 30 rad/s
    const w0 = b.w.z;
    let totalTime = 0;
    let steps = 0;
    while (b.w.z > 0 && steps < 1_000_000) {
      integrateAll([b], p, SIM.dt);
      totalTime += SIM.dt;
      steps++;
      if (steps > 100 && b.w.z > w0) throw new Error("ω_z 异常增加");
    }
    // 期望：~ (5·u_sp·g)/(2R) 衰减率 ≈ 5·0.0127·9.81/(2·0.0286) ≈ 10.9 rad/s²
    // ω_z 从 30 衰减到 0 ≈ 2.75s；位置不变
    expect(b.w.z).toBe(0);
    expect(b.pos.x).toBeCloseTo(0.5, 6);
    expect(b.pos.y).toBeCloseTo(0.5, 6);
    expect(totalTime).toBeGreaterThan(2);
    expect(totalTime).toBeLessThan(4);
  });

  it("spinning 不影响 v 已停球的 vel：始终 0", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    b.w.z = SPIN_SCALE;
    b.vel = vec2(0, 0);
    for (let i = 0; i < 1000; i++) integrateAll([b], p, SIM.dt);
    expect(b.vel.x).toBe(0);
    expect(b.vel.y).toBe(0);
  });
});

describe("v1 spin · 边界", () => {
  it("spin 分量被裁剪到 [-1,1]：超出值不抛错，按输入处理（schema 层校验）", () => {
    // schema 层负责 [-1,1] 校验；engine 层只信任输入
    const b = makeBall("cue", vec2(0.5, 0.5));
    strike(b, 0, 0.5, { x: 2, y: -3, z: 0.5 });
    expect(b.w.x).toBe(2 * SPIN_SCALE);
    expect(b.w.y).toBe(-3 * SPIN_SCALE);
  });

  it("v0 兼容：spin=0 strike 滑动距离（v0 公式不变）", () => {
    // 这个测试在 physics.test.ts 已有，这里仅确认 v1 改动不破坏 simulate() 路径
    const cue = makeBall("cue", vec2(0.3, 0.5));
    strike(cue, 0, 0.6);
    const r = simulate([cue], table, p);
    const final = r.balls[0]!;
    expect(r.stopReason).toBe("stopped");
    // 解析值 0.981m（physics.test.ts 验证过），容差 ±5%
    expect(final.pos.x).toBeGreaterThan(0.3 + 0.93);
    expect(final.pos.x).toBeLessThan(0.3 + 1.03);
  });
});
