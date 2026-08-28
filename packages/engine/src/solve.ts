/**
 * 瞄准求解器（docs/physics.md §6：research 用，绝不暴露给 Agent）
 * v0：ghost ball 切线法（等价 pooltool ai.pot.calc_potting_angle v0 能力域：
 * 忽略 throw、不翻袋）。返回击打方向角（度，与 strike 同一约定）。
 */
import type { Table } from "./table.ts";
import { dist, norm, sub, type Vec2, vec2 } from "./vec2.ts";

/** 目标球 → 袋口的进球线：ghost ball 位（目标球后方 R 处沿袋口反方向） */
export function ghostPos(obj: Vec2, pocketCenter: Vec2, R: number): Vec2 {
  const dir = norm(sub(pocketCenter, obj));
  return { x: obj.x - dir.x * 2 * R, y: obj.y - dir.y * 2 * R };
}

/**
 * 最优击打角（度）：母球瞄准 ghost ball 位置。
 * 返回 null 表示几何不可行（母球与 ghost 重合）。
 */
export function solvePot(cue: Vec2, obj: Vec2, pocketCenter: Vec2, R: number): number | null {
  const ghost = ghostPos(obj, pocketCenter, R);
  const aim = sub(ghost, cue);
  if (dist(aim, vec2(0, 0)) < 1e-9) return null;
  // 屏幕坐标 y 向下：数学角 = atan2(-dy, dx)（与 strike 约定一致）
  return (Math.atan2(-aim.y, aim.x) * 180) / Math.PI;
}

/** 便捷版：按袋口 id 取袋心 */
export function solvePotPocket(
  cue: Vec2,
  obj: Vec2,
  pocketId: string,
  table: Table,
  R: number,
): number | null {
  const pk = table.pockets.find((p) => p.id === pocketId);
  if (!pk) return null;
  return solvePot(cue, obj, pk.center, R);
}
