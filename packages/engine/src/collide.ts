/**
 * 碰撞解算（docs/physics.md §3 §4）
 * 球-球：等质量、沿连心线、恢复系数 e_b + v2 throw（spin_z → vel 切向）
 * 库边：法向 e_c 反弹 + 切向保留 + v2 加塞（spin_z → vel 切向）
 */
import type { BallParams } from "./consts.ts";
import type { Ball, CushionDir } from "./types.ts";
import { dist, EPS, scale, sub, vec2 } from "./vec2.ts";

/** 球-球冲量解算（v2：throw 把 ω_z 转化为 vel 切向分量，高低杆涌现） */
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

  // v2 throw: ω_z → vel 切向分量（高杆跟球 / 缩球回退涌现）
  // 切向方向 = (-n.y, n.x)；a 的 ω_z 给 b 反向切向 push；b 的 ω_z 给 a 反向切向 push
  if (p.throwSigma > 0) {
    const tang = { x: -n.y, y: n.x };
    const jThrow = p.throwSigma * p.R;
    const pushA = -b.w.z * jThrow;
    const pushB = -a.w.z * jThrow;
    a.vel = { x: a.vel.x + pushA * tang.x, y: a.vel.y + pushA * tang.y };
    b.vel = { x: b.vel.x + pushB * tang.x, y: b.vel.y + pushB * tang.y };
  }
}

/** 库边反弹：法向 ×(-e_c)，切向 ×tangentKeep；v2 加塞：spin_z → vel 切向 push */
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

  // v2 加塞：spin_z → vel 切向 push
  if (p.cushionSpinSigma > 0) {
    const tangX = dir === "up" || dir === "down" ? 1 : 0;
    const tangY = dir === "up" || dir === "down" ? 0 : 1;
    // 方向：right/up 加塞方向与 vel 切向方向同；left/down 反向
    // 简化：spin × R × σ × sign（待 golden 校准）
    const sign = dir === "right" || dir === "up" ? 1 : -1;
    const push = ball.w.z * p.R * p.cushionSpinSigma * sign;
    ball.vel = { x: ball.vel.x + push * tangX, y: ball.vel.y + push * tangY };
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
