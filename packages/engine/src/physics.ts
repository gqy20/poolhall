/**
 * 摩擦积分（docs/physics.md §3 状态机，半隐式欧拉，dt=1ms）
 *
 * sliding：v̇ = −u_s·g·û；ω̇ = ±(5·u_s·g)/(2R)·û⊥（力矩直接推导）
 *   接触点速度 u 以 (7/2)·u_s·g 收敛到 0（教科书结果，单测验证）
 * rolling：v̇ = −u_r·g·v̂；ω 与 v 仅在 |ω - 自然值| < 阈值时锁定（v3 阈值化）
 * stationary：|v|、|u| 均低于阈值 → 冻结
 * 半隐式欧拉：先更新速度（摩擦），再用新速度推位置（稳定性）。
 *
 * v3 改动（spin.x/y 真实走位）：
 * - sliding 段 ω 卷向自然滚动的速率不受 spin.x/y 注入残量影响（仍按物理力矩），
 *   但 rolling 段不再无条件 lockRoll——若 |ω - 自然值| > 阈值则保留 spin 残量
 *   （让 spin.x/y 注入的角速度能"穿透" rolling 分支，继续影响后续库边/碰撞）
 * - 阈值以 spinStop（0.1 rad/s）的 5× 为界：自然滚动收敛残余 < 阈值视为锁定；
 *   高杆/低杆的额外 ω 残量（典型 5-30 rad/s）远大于阈值，保留到底
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
    // v3：rolling lockRoll 阈值化（spin.x/y 残量穿透）
    // 自然滚动值：ω.x = -v.y/R，ω.y = v.x/R
    const naturalWx = -ball.vel.y / p.R;
    const naturalWy = ball.vel.x / p.R;
    const dWx = ball.w.x - naturalWx;
    const dWy = ball.w.y - naturalWy;
    const dev = Math.hypot(dWx, dWy);
    // 阈值=spinStop×5（0.5 rad/s）：低于此视为自然滚动收敛残量→锁
    // 高杆/低杆的额外 ω（5-30 rad/s）远高于此→保留注入残量
    if (dev < 5 * SIM.spinStop) {
      lockRoll(ball, p);
    }
    // 残量较大的 spin.x/y 注入保留，参与后续库边/碰撞
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
