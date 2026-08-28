/**
 * 共享类型（docs/proto.md 对齐：事件类型与回放格式字段一致）
 */
import type { Vec2 } from "./vec2.ts";

export type BallId = string;

/** 角速度三分量（v0：z 恒 0；v1 解冻 x/y；v2 解冻 z） */
export interface Spin3 {
  x: number;
  y: number;
  z: number;
}

export interface Ball {
  id: BallId;
  pos: Vec2;
  vel: Vec2;
  w: Spin3;
  /** 已进袋 */
  pocketed: boolean;
  /** 进袋的袋口 id */
  pocket?: string;
}

export type CushionDir = "up" | "down" | "left" | "right";

export type EventKind = "ball-ball" | "ball-cushion" | "pocket";

export interface MotionEvent {
  /** 出杆后累计时刻 s */
  t: number;
  kind: EventKind;
  a: BallId;
  /** 碰撞对方球 id（ball-ball） */
  b?: BallId;
  /** 库边方向（ball-cushion） */
  cushion?: CushionDir;
  /** 袋口 id（pocket） */
  pocket?: string;
}

export interface Sample {
  t: number;
  /** 球位快照（id → 位置；pocketed 球固定在袋心） */
  pos: Record<BallId, Vec2>;
}

export type StopReason = "stopped" | "watchdog";

export interface SimResult {
  events: MotionEvent[];
  samples: Sample[];
  /** 终态球列表（含 pocketed） */
  balls: Ball[];
  /** 模拟时长 s */
  simTime: number;
  stopReason: StopReason;
}
