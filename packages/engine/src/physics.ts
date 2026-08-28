/**
 * 摩擦积分（docs/physics.md §3 状态机，半隐式欧拉，dt=1ms）
 *
 * sliding：v̇ = −u_s·g·û；ω̇ = ±(5·u_s·g)/(2R)·û⊥（力矩直接推导）
 *   接触点速度 u 以 (7/2)·u_s·g 收敛到 0（教科书结果，单测验证）
 * rolling：v̇ = −u_r·g·v̂；ω 每步锁定自然滚动
 * stationary：|v|、|u| 均低于阈值 → 冻结
 * 半隐式欧拉：先更新速度（摩擦），再用新速度推位置（稳定性）。
 */

import { contactVel, lockRoll } from "./ball.ts";
import { type BallParams, SIM } from "./consts.ts";
import type { Ball } from "./types.ts";
import { len, norm, scale } from "./vec2.ts";

/** 单球推进 dt（确定性：运算顺序固定） */
export function integrateBall(ball: Ball, p: BallParams, dt: number): void {
  if (ball.pocketed) return;
  const u = contactVel(ball, p);
  const uMag = len(u);
  const vMag = len(ball.vel);

  // spinning（v1 解冻）：v ≈ 0 且 ω_z 显著 → 纯自转衰减，位置不变
  if (vMag < SIM.stopV && Math.abs(ball.w.z) > SIM.spinStop) {
    const dec = ((5 * p.u_sp * p.g) / (2 * p.R)) * dt;
    if (Math.abs(ball.w.z) <= dec) {
      ball.w.z = 0;
    } else {
      ball.w.z -= Math.sign(ball.w.z) * dec;
    }
    return;
  }

  if (uMag < SIM.uStop) {
    // 自然滚动（或停球）
    if (vMag < SIM.stopV) {
      ball.vel = { x: 0, y: 0 };
      ball.w = { x: 0, y: 0, z: 0 };
      return;
    }
    const dec = p.u_r * p.g * dt;
    const nv = Math.max(0, vMag - dec);
    ball.vel = scale(norm(ball.vel), nv);
    // v1: rolling 仍 lockRoll（v0 行为保留）；spin 注入通过 sliding 卷向
    // 自然滚动 + 库边/碰撞 throw 转化的复杂路径是 v2 范畴
    lockRoll(ball, p);
  } else {
    // 滑动：û 方向摩擦减速 + 力矩卷入角速度
    const uh = { x: u.x / uMag, y: u.y / uMag };
    const a = p.u_s * p.g * dt;
    ball.vel = { x: ball.vel.x - a * uh.x, y: ball.vel.y - a * uh.y };
    const alpha = ((5 * p.u_s * p.g) / (2 * p.R)) * dt;
    ball.w.x -= alpha * uh.y;
    ball.w.y += alpha * uh.x;
  }

  // 半隐式欧拉：用更新后的速度推位置
  ball.pos = { x: ball.pos.x + ball.vel.x * dt, y: ball.pos.y + ball.vel.y * dt };
}

/** 全部球推进 dt */
export function integrateAll(balls: Ball[], p: BallParams, dt: number): void {
  for (const b of balls) integrateBall(b, p, dt);
}
