/**
 * 扫掠碰撞检测（docs/physics.md §5：步内解析求最早碰撞时刻 t*）
 * 三类事件：球-球（二次方程）、球-库边（线性）、球-袋口（进入圆，二次方程）。
 */

import { isLive } from "./ball.ts";
import type { BallParams } from "./consts.ts";
import { reboundLine, type Table } from "./table.ts";
import type { Ball, CushionDir } from "./types.ts";
import { dot, sub, type Vec2 } from "./vec2.ts";

export type Collision =
  | { kind: "ball-ball"; t: number; a: Ball; b: Ball }
  | { kind: "ball-cushion"; t: number; ball: Ball; dir: CushionDir }
  | { kind: "pocket"; t: number; ball: Ball; pocket: string };

/** 球-球：解 |d + v·t| = 2R 最小非负根；仅真实重叠才允许 t=0 */
function ballBallT(a: Ball, b: Ball, p: BallParams): number | null {
  const d = sub(b.pos, a.pos);
  const v = sub(b.vel, a.vel);
  const A = dot(v, v);
  if (A < 1e-12) return null;
  const B = dot(d, v);
  const C = dot(d, d) - 4 * p.R * p.R;
  const disc = B * B - A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / A;
  if (t < 1e-9) return C < -1e-9 ? 0 : null;
  return t;
}

/** 球-库边：球心到达反弹线的时刻，且接触点落在库边段内 */
function cushionT(
  ball: Ball,
  table: Table,
  p: BallParams,
  seg: { dir: CushionDir; lo: number; hi: number },
): number | null {
  const line = reboundLine(table, seg, p.R);
  const horiz = seg.dir === "left" || seg.dir === "right";
  const pos = horiz ? ball.pos.x : ball.pos.y;
  const vel = horiz ? ball.vel.x : ball.vel.y;
  const approaching = seg.dir === "up" || seg.dir === "left" ? vel < -1e-9 : vel > 1e-9;
  if (!approaching) return null;
  // 已越过反弹线（浮点残差）→ 立刻修正
  const crossed = seg.dir === "up" || seg.dir === "left" ? pos < line - 1e-9 : pos > line + 1e-9;
  if (crossed) return 0;
  const gap = Math.abs(pos - line);
  const speed = Math.abs(vel);
  if (speed < 1e-12) return null;
  const t = gap / speed;
  const other = horiz ? ball.pos.y : ball.pos.x;
  const otherV = horiz ? ball.vel.y : ball.vel.x;
  const contact = other + otherV * t;
  if (contact < seg.lo - 1e-9 || contact > seg.hi + 1e-9) return null;
  return t;
}

/** 球-袋口：球心进入判定圆的时刻（只在朝袋心接近时） */
function pocketT(ball: Ball, center: Vec2, r: number): number | null {
  const d = sub(ball.pos, center);
  const dist2 = dot(d, d);
  if (dist2 < r * r) return 0;
  const v = ball.vel;
  const A = dot(v, v);
  if (A < 1e-12) return null;
  const B = dot(d, v);
  if (B >= 0) return null;
  const disc = B * B - A * (dist2 - r * r);
  if (disc <= 0) return null;
  return (-B - Math.sqrt(disc)) / A;
}

const kindOrder = { "ball-ball": 0, "ball-cushion": 1, pocket: 2 } as const;

/** 全桌最早碰撞（t 最小；并列按 kind 序，保证确定性） */
export function earliestCollision(
  balls: Ball[],
  table: Table,
  p: BallParams,
  dtMax: number,
): Collision | null {
  let best: Collision | null = null;
  const consider = (c: Collision | null): void => {
    if (!c || c.t > dtMax + 1e-12) return;
    if (c.t < 0) return;
    if (
      !best ||
      c.t < best.t - 1e-12 ||
      (Math.abs(c.t - best.t) <= 1e-12 && kindOrder[c.kind] < kindOrder[best.kind])
    ) {
      best = c;
    }
  };

  const live = balls.filter(isLive);
  for (let i = 0; i < live.length; i++) {
    const a = live[i] as Ball;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j] as Ball;
      const t = ballBallT(a, b, p);
      if (t !== null) consider({ kind: "ball-ball", t, a, b });
    }
    for (const seg of table.cushions) {
      const t = cushionT(a, table, p, seg);
      if (t !== null) consider({ kind: "ball-cushion", t, ball: a, dir: seg.dir });
    }
    for (const pk of table.pockets) {
      const t = pocketT(a, pk.center, pk.r);
      if (t !== null) consider({ kind: "pocket", t, ball: a, pocket: pk.id });
    }
  }
  return best;
}
