/**
 * 台面几何（docs/physics.md §4.2/§4.3）
 * v0：库边 = 台面矩形边界直线段（袋口开口处无库边）；袋口 = 圆判定区。
 * 几何自洽性：开口宽 = 判定圆直径 → 球心越界前必先进圆或先碰库（连续性），
 * 不存在"飞出台面"的路径。
 */
import { SEVEN_FOOT, type TableSpecs } from "./consts.ts";
import type { CushionDir } from "./types.ts";
import { type Vec2, vec2 } from "./vec2.ts";

export interface CushionSeg {
  dir: CushionDir;
  /** 沿边坐标区间（接触点坐标范围） */
  lo: number;
  hi: number;
}

export interface Pocket {
  id: string;
  center: Vec2;
  r: number;
}

export interface Table {
  width: number;
  height: number;
  pockets: Pocket[];
  cushions: CushionSeg[];
}

/** 由库边段方向求球心反弹线坐标（球心到边界的距离 = R） */
export function reboundLine(table: Table, seg: CushionSeg, R: number): number {
  switch (seg.dir) {
    case "up":
      return R;
    case "down":
      return table.height - R;
    case "left":
      return R;
    case "right":
      return table.width - R;
  }
}

/** 构建台面（默认美式 7 尺台） */
export function buildTable(specs: TableSpecs = SEVEN_FOOT): Table {
  const { width: w, height: h, cornerMouth, sideMouth } = specs;
  const cHalf = cornerMouth / 2;
  const sHalf = sideMouth / 2;
  const midX = w / 2;
  const pockets: Pocket[] = [
    { id: "lt", center: vec2(0, 0), r: cHalf },
    { id: "rt", center: vec2(w, 0), r: cHalf },
    { id: "lb", center: vec2(0, h), r: cHalf },
    { id: "rb", center: vec2(w, h), r: cHalf },
    { id: "ct", center: vec2(midX, 0), r: sHalf },
    { id: "cb", center: vec2(midX, h), r: sHalf },
  ];
  const cushions: CushionSeg[] = [
    { dir: "up", lo: cHalf, hi: midX - sHalf },
    { dir: "up", lo: midX + sHalf, hi: w - cHalf },
    { dir: "down", lo: cHalf, hi: midX - sHalf },
    { dir: "down", lo: midX + sHalf, hi: w - cHalf },
    { dir: "left", lo: cHalf, hi: h - cHalf },
    { dir: "right", lo: cHalf, hi: h - cHalf },
  ];
  return { width: w, height: h, pockets, cushions };
}
