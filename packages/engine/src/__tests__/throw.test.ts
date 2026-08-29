/**
 * v2 throw 测试（docs/physics.md §3 §4）
 *
 * 验证"中高低杆 + 旋球"的涌现：
 * - 球-球 throw：spin_z → vel 切向 → 高杆跟球 / 缩球回退
 * - 库边加塞：spin_z → vel 切向 → 加塞变线
 *
 * 物理公式：j_spin = ω_z · R · throwSigma（经验系数，实验值校准）
 */

import { describe, expect, it } from "vitest";
import { makeBall, strike } from "../ball.ts";
import { resolveBallBall, resolveCushion } from "../collide.ts";
import { DEFAULT_BALL, SPIN_SCALE } from "../consts.ts";
import { simulate } from "../simulate.ts";
import { buildTable } from "../table.ts";
import { len, vec2 } from "../vec2.ts";

const table = buildTable();
const p = DEFAULT_BALL;

describe("v2 throw · 球-球 spin→vel 切向", () => {
  it("v0 兼容：spin=0 球-球碰撞，vel 切向分量为 0（v0 严格）", () => {
    const a = makeBall("a", vec2(0.5, 0.5));
    const b = makeBall("b", vec2(2 * p.R + 1e-9, 0.5)); // 紧贴不重叠
    a.vel = vec2(2, 0);
    b.vel = vec2(0, 0);
    resolveBallBall(a, b, p);
    // 切向（垂直于 n=(1,0)，即 y 方向）应无变化
    expect(Math.abs(a.vel.y)).toBeLessThan(1e-9);
    expect(Math.abs(b.vel.y)).toBeLessThan(1e-9);
  });

  it("topspin (spin.z=+1)：a 撞静止 b，a.vel 切向 push 应为负（减速）", () => {
    // a 在左，b 在右，a 向右撞 b；spin=+1 给 a vel_y 一个 push
    const a = makeBall("a", vec2(0.5, 0.5));
    const b = makeBall("b", vec2(0.5 + 2 * p.R, 0.5));
    a.vel = vec2(2, 0);
    a.w.z = SPIN_SCALE; // +30 rad/s
    b.vel = vec2(0, 0);
    b.w.z = 0;
    resolveBallBall(a, b, p);
    // b 受到 a 的 spin 切向 push：tang = (-n.y, n.x) = (0, 1)
    // jThrow = 0.05 * R；pushB = -a.w.z * jThrow = -30 * 0.05 * 0.0286 ≈ -0.043
    // b.vel.y 应为负（-0.043 量级）
    expect(b.vel.y).toBeLessThan(-1e-3);
  });

  it("backspin (spin.z=-1)：a 撞静止 b，b.vel.y 应为正（与 top 相反）", () => {
    const a = makeBall("a", vec2(0.5, 0.5));
    const b = makeBall("b", vec2(0.5 + 2 * p.R, 0.5));
    a.vel = vec2(2, 0);
    a.w.z = -SPIN_SCALE; // -30 rad/s（backspin）
    resolveBallBall(a, b, p);
    expect(b.vel.y).toBeGreaterThan(1e-3);
  });

  it("throw 不改变 vel 法向分量（v0 行为保留）", () => {
    const a = makeBall("a", vec2(0.5, 0.5));
    const b = makeBall("b", vec2(0.5 + 2 * p.R, 0.5));
    a.vel = vec2(2, 0);
    a.w.z = SPIN_SCALE;
    const aVxBefore = a.vel.x;
    const bVxBefore = b.vel.x;
    resolveBallBall(a, b, p);
    // 法向（x 方向）总动量守恒：a.vx + b.vx = 2（等质量）
    expect(a.vel.x + b.vel.x).toBeCloseTo(aVxBefore + bVxBefore, 9);
  });
});

describe("v2 throw · 库边加塞 spin→vel 切向", () => {
  it("spin.z=+1 撞右库：vel.y 应有正向 push", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    b.vel = vec2(2, 0); // 向右飞
    b.w.z = SPIN_SCALE;
    resolveCushion(b, "right", p);
    // v0 法向反弹：vx → -2 * 0.85 = -1.7；vy → 0
    // v2 加塞：push = 30 * R * 0.08 * 1 = 30 * 0.0286 * 0.08 ≈ 0.069
    expect(b.vel.x).toBeCloseTo(-1.7, 9);
    expect(b.vel.y).toBeGreaterThan(1e-2);
  });

  it("spin.z=+1 撞左库：vel.y 应有负向 push（sign 反）", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    b.vel = vec2(-2, 0);
    b.w.z = SPIN_SCALE;
    resolveCushion(b, "left", p);
    // v0：vx → 2*0.85=1.7, vy→0；v2 加塞：push sign=-1，vy 应负
    expect(b.vel.x).toBeCloseTo(1.7, 9);
    expect(b.vel.y).toBeLessThan(-1e-2);
  });

  it("spin=0 撞右库：vel.y 应为 0（v0 兼容）", () => {
    const b = makeBall("cue", vec2(0.5, 0.5));
    b.vel = vec2(2, 0);
    resolveCushion(b, "right", p);
    expect(b.vel.x).toBeCloseTo(-1.7, 9);
    expect(b.vel.y).toBe(0);
  });
});

describe("v2 throw · 涌现：高杆跟球", () => {
  it("topspin 直线撞目标球后母球位置 y 方向偏移（v2 throw 涌现）", () => {
    // cue 在 (0.3, 0.5)，obj 在 (0.5, 0.5)，直线撞
    // v0: cue 出杆 → 碰 obj 后 cue 反向、obj 向前；vel 都是 x 方向；y 方向无动
    // v2 topspin: 碰 obj 时 spin.z → vel.y 切向 push；cue 终态位置应偏离 y=0.5
    const cue = makeBall("cue", vec2(0.3, 0.5));
    const obj = makeBall("1", vec2(0.5, 0.5));
    strike(cue, 0, 0.4, { x: 0, y: 0, z: 1 }); // top spin
    const r = simulate([cue, obj], table, p);
    const cueFinal = r.balls.find((b) => b.id === "cue")!;
    const objFinal = r.balls.find((b) => b.id === "1")!;
    // v2 throw 应让 cue 终态位置偏离 y=0.5（切向偏移）
    const cueDy = Math.abs(cueFinal.pos.y - 0.5);
    expect(cueDy).toBeGreaterThan(1e-3);
    // obj 也应有 y 方向偏移（throw 影响）
    const objDy = Math.abs(objFinal.pos.y - 0.5);
    expect(objDy).toBeGreaterThan(1e-4);
  });

  it("v0 对照：spin=0 直线撞目标球后母球位置 y 方向无偏移（v0 严格）", () => {
    const cue = makeBall("cue", vec2(0.3, 0.5));
    const obj = makeBall("1", vec2(0.5, 0.5));
    strike(cue, 0, 0.4); // spin=0
    const r = simulate([cue, obj], table, p);
    const cueFinal = r.balls.find((b) => b.id === "cue")!;
    const cueDy = Math.abs(cueFinal.pos.y - 0.5);
    expect(cueDy).toBeLessThan(1e-6); // y 方向无偏移
  });
});

describe("v2 throw · 涌现：加塞变线", () => {
  it("spin.z=+1 撞右库后母球切向偏移（v0 行为弹回无偏移）", () => {
    const cue = makeBall("cue", vec2(0.3, 0.5));
    strike(cue, 0, 0.5, { x: 0, y: 0, z: 1 }); // 加塞
    const r = simulate([cue], table, p);
    const cueFinal = r.balls[0]!;
    // v2 加塞：撞右库后 vel.y 有正向 push，终态 y ≠ 0.5
    const dy = Math.abs(cueFinal.pos.y - 0.5);
    expect(dy).toBeGreaterThan(1e-3);
  });

  it("v0 对照：spin=0 撞右库后母球 y 方向无偏移", () => {
    const cue = makeBall("cue", vec2(0.3, 0.5));
    strike(cue, 0, 0.5); // spin=0
    const r = simulate([cue], table, p);
    const cueFinal = r.balls[0]!;
    const dy = Math.abs(cueFinal.pos.y - 0.5);
    expect(dy).toBeLessThan(1e-6);
  });
});
