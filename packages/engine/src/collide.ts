/**
 * 碰撞解算（docs/physics.md §3）
 * 球-球：等质量、沿连心线、恢复系数 e_b，切向不变（v0 无 throw）。
 * 库边：法向 e_c 反弹 + 切向保留；ω 不变（碰撞后短暂打滑由积分器自然处理）。
 */
import type { BallParams } from "./consts.ts";
import type { Ball, CushionDir } from "./types.ts";
import { dist, EPS, scale, sub, vec2 } from "./vec2.ts";

/** 球-球冲量解算（含重叠分离修正） */
export function resolveBallBall(a: Ball, b: Ball, p: BallParams): void {
  const d = sub(b.pos, a.pos);
  const gap = dist(b.pos, a.pos);
  const n = gap < EPS ? vec2(1, 0) : scale(d, 1 / gap);

  // 重叠分离：沿连心线各推一半，推到恰好接触 + 微量过分离防复触发
  const overlap = 2 * p.R - gap;
  if (overlap > 1e-12) {
    const push = overlap / 2 + 1e-9;
    a.pos = { x: a.pos.x - n.x * push, y: a.pos.y - n.y * push };
    b.pos = { x: b.pos.x + n.x * push, y: b.pos.y + n.y * push };
  }

  // 法向相对速度（b 相对 a 的接近速度）；分离中只做位置修正
  const relN = (b.vel.x - a.vel.x) * n.x + (b.vel.y - a.vel.y) * n.y;
  if (relN > -EPS) return;

  // 等质量：每球法向速度分量按恢复系数交换
  const j = ((1 + p.e_b) / 2) * -relN;
  a.vel = { x: a.vel.x - j * n.x, y: a.vel.y - j * n.y };
  b.vel = { x: b.vel.x + j * n.x, y: b.vel.y + j * n.y };
}

/** 库边反弹：法向 ×(-e_c)，切向 ×tangentKeep */
export function resolveCushion(ball: Ball, dir: CushionDir, p: BallParams): void {
  switch (dir) {
    case "up":
      ball.vel = vec2(ball.vel.x * p.tangentKeep, -ball.vel.y * p.e_c);
      break;
    case "down":
      ball.vel = vec2(ball.vel.x * p.tangentKeep, -ball.vel.y * p.e_c);
      break;
    case "left":
      ball.vel = vec2(-ball.vel.x * p.e_c, ball.vel.y * p.tangentKeep);
      break;
    case "right":
      ball.vel = vec2(-ball.vel.x * p.e_c, ball.vel.y * p.tangentKeep);
      break;
  }
}

/** 进袋：固定到袋心，速度清零 */
export function pocketBall(ball: Ball, pocketId: string, center: { x: number; y: number }): void {
  ball.pocketed = true;
  ball.pocket = pocketId;
  ball.vel = vec2(0, 0);
  ball.w = { x: 0, y: 0, z: 0 };
  ball.pos = { x: center.x, y: center.y };
}
