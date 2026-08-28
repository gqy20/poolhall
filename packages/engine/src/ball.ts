/**
 * 球对象与运动状态（docs/physics.md §3）
 * 状态（stationary/sliding/rolling/pocketed）由 (v, ω) 派生，无显式转移事件。
 */
import { type BallParams, POWER, speedOf } from "./consts.ts";
import type { Ball, BallId } from "./types.ts";
import { len, type Vec2, vec2 } from "./vec2.ts";

export const makeBall = (id: BallId, pos: Vec2): Ball => ({
  id,
  pos,
  vel: vec2(0, 0),
  w: { x: 0, y: 0, z: 0 },
  pocketed: false,
});

/**
 * 出杆：angle 度（0=+x，屏幕逆时针为正，docs/proto.md §1.2），
 * power ∈ [0,1]。v0 spin 冻结：ω 起步为 0 → 必然经历滑动段。
 */
export function strike(ball: Ball, angleDeg: number, power: number): void {
  const rad = (angleDeg * Math.PI) / 180;
  const speed = speedOf(Math.min(1, Math.max(0, power)));
  ball.vel = vec2(Math.cos(rad) * speed, -Math.sin(rad) * speed);
  ball.w = { x: 0, y: 0, z: 0 };
}

/** 接触点相对台面速度 u = (vx − R·ωy, vy + R·ωx)（Han 2005） */
export function contactVel(ball: Ball, p: BallParams): Vec2 {
  return vec2(ball.vel.x - p.R * ball.w.y, ball.vel.y + p.R * ball.w.x);
}

export type BallState = "stationary" | "sliding" | "rolling" | "pocketed";

/** 派生运动状态（docs/physics.md §3 状态机） */
export function deriveState(ball: Ball, p: BallParams): BallState {
  if (ball.pocketed) return "pocketed";
  const u = contactVel(ball, p);
  if (len(u) >= 0.01) return "sliding";
  return len(ball.vel) >= 0.01 ? "rolling" : "stationary";
}

/** 锁定自然滚动：ωy = vx/R, ωx = −vy/R */
export function lockRoll(ball: Ball, p: BallParams): void {
  ball.w.y = ball.vel.x / p.R;
  ball.w.x = -ball.vel.y / p.R;
}

export const isLive = (ball: Ball): boolean => !ball.pocketed;

export const isMoving = (ball: Ball, p: BallParams): boolean =>
  deriveState(ball, p) !== "stationary";

export { POWER };
