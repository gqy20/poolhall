/**
 * @poolhall/engine · 物理核
 *
 * 铁律（AGENTS.md §2.4）：零依赖、零 I/O、零随机源。
 * 物理规格见 docs/physics.md。
 */

export type { BallState } from "./ball.ts";
export { contactVel, deriveState, lockRoll, makeBall, strike } from "./ball.ts";
export { pocketBall, resolveBallBall, resolveCushion } from "./collide.ts";
export type { BallParams, TableSpecs } from "./consts.ts";
export {
  CHINESE_EIGHT,
  DEFAULT_BALL,
  POWER,
  SEVEN_FOOT,
  SIM,
  speedOf,
} from "./consts.ts";
export { integrateAll, integrateBall } from "./physics.ts";
export type { SimOpts } from "./simulate.ts";
export { serializeTrajectory, simulate } from "./simulate.ts";
export { ghostPos, solvePot, solvePotPocket } from "./solve.ts";
export type { Collision } from "./sweep.ts";
export { earliestCollision } from "./sweep.ts";
export type { CushionSeg, Pocket, Table } from "./table.ts";
export { buildTable, reboundLine } from "./table.ts";
export type {
  Ball,
  BallId,
  CushionDir,
  EventKind,
  MotionEvent,
  Sample,
  SimResult,
  Spin3,
  StopReason,
} from "./types.ts";
export type { Vec2 } from "./vec2.ts";

export { add, dist, dot, len, len2, norm, scale, sub, vec2 } from "./vec2.ts";
export { ENGINE_VERSION } from "./version.ts";
