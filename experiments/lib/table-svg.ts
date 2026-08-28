/**
 * 台面 SVG 渲染（docs/visualization.md：墨绿呢 + 木库边 + 六袋）
 * 坐标系：与引擎一致（左上原点，x 向右，y 向下，单位米）——viewBox 即台面坐标
 */
import { C, SIZE } from "./style.ts";
import { circle, el, line, path, polyline, rect } from "./svg.ts";

const R_BALL = 0.0286;
const C_RAIL = 0.0508;

export interface TableGeom {
  width: number;
  height: number;
  pockets: Array<{ id: string; center: { x: number; y: number }; r: number }>;
}

/** 台面边框 + 呢面 + 袋口 + 中线的静态背景 */
export function tableBase(geom: TableGeom): string {
  const { width: w, height: h, pockets } = geom;
  const pad = C_RAIL;
  return el("g", {}, [
    // 外框（木库）
    rect(-pad, -pad, w + pad * 2, h + pad * 2, {
      fill: C.wood,
      rx: 0.008,
      stroke: C.woodEdge,
      "stroke-width": 0.002,
    }),
    // 呢面
    rect(0, 0, w, h, { fill: C.felt }),
    // 六袋（圆判定区，r=口宽/2）
    ...pockets.map((p) =>
      circle(p.center.x, p.center.y, p.r, {
        fill: C.pocket,
        opacity: 0.95,
      }),
    ),
    // 中线（虚，轻）
    path(`M ${w / 2} 0 L ${w / 2} ${h}`, {
      stroke: C.grid,
      "stroke-width": 0.0008,
      "stroke-dasharray": "0.008,0.006",
    }),
  ]);
}

export interface ShotVizInput {
  trial: number;
  /** 母球初始位 */
  cueInit: { x: number; y: number };
  /** 目标球初始位 */
  objInit: { x: number; y: number };
  /** 目标袋 */
  pocketId: string;
  pocketCenter: { x: number; y: number };
  pocketR: number;
  /** 出杆意图角（度） */
  intentAngle: number;
  /** 实际角（注入后） */
  actualAngle: number;
  /** 预测/最优角 */
  optimal: number | null;
  /** 进球与否 */
  pot: boolean;
  /** 母球轨迹样本（10ms） */
  cueSamples: Array<{ x: number; y: number }>;
  /** 目标球轨迹样本 */
  objSamples: Array<{ x: number; y: number }>;
  /** 终位 */
  cueFinal: { x: number; y: number };
  objFinal: { x: number; y: number };
  objPocketed: boolean;
}

/**
 * 单杆台面目视图：
 *  - 蓝墨虚线 = 意图（cue→ghost 的意图线，从 intentAngle 反向截断）
 *  - 暖橙实线 = 实际母球轨迹
 *  - 砖红/墨绿 = 目标球轨迹（miss/pot 分色）
 *  - ghost 位画一个小十字（agent 的"心算瞄准点"参考）
 */
export function shotCardSvg(input: ShotVizInput, geom: TableGeom): string {
  const parts: string[] = [tableBase(geom)];

  // ghost 位（已知场：目标球背向袋 2R）
  const ux = input.objInit.x - input.pocketCenter.x;
  const uy = input.objInit.y - input.pocketCenter.y;
  const ul = Math.hypot(ux, uy) || 1;
  const ghost = {
    x: input.objInit.x + (ux / ul) * 2 * R_BALL,
    y: input.objInit.y + (uy / ul) * 2 * R_BALL,
  };

  // 预测意图线：cue → ghost 方向上的短线（意图=agent 打算走的方向）
  const rad = (input.intentAngle * Math.PI) / 180;
  const aimLen = Math.hypot(ghost.x - input.cueInit.x, ghost.y - input.cueInit.y);
  const intentEnd = {
    x: input.cueInit.x + Math.cos(rad) * aimLen,
    y: input.cueInit.y - Math.sin(rad) * aimLen,
  };
  parts.push(
    polyline(
      [
        [input.cueInit.x, input.cueInit.y],
        [intentEnd.x, intentEnd.y],
      ],
      { stroke: C.predict, "stroke-width": 0.003, "stroke-dasharray": "0.01,0.008", opacity: 0.7 },
    ),
  );
  // 期望目标球线：ghost → pocket（短线）
  parts.push(
    polyline(
      [
        [ghost.x, ghost.y],
        [input.pocketCenter.x, input.pocketCenter.y],
      ],
      { stroke: C.predict, "stroke-width": 0.002, "stroke-dasharray": "0.008,0.008", opacity: 0.4 },
    ),
  );

  // 实际母球轨迹（暖橙实线）
  if (input.cueSamples.length > 1) {
    parts.push(
      polyline(
        input.cueSamples.map((s) => [s.x, s.y]),
        {
          stroke: C.actual,
          "stroke-width": 0.0025,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
      ),
    );
  }
  // 实际目标球轨迹
  if (input.objSamples.length > 1) {
    parts.push(
      polyline(
        input.objSamples.map((s) => [s.x, s.y]),
        { stroke: input.pot ? C.pot : C.miss, "stroke-width": 0.002, opacity: 0.8 },
      ),
    );
  }

  // 点位：母球起点（白）、目标球起点（黄）、母球终点、目标球终点/miss 标记
  parts.push(
    circle(input.cueInit.x, input.cueInit.y, R_BALL, {
      fill: C.cue,
      stroke: C.ink,
      "stroke-width": 0.001,
    }),
  );
  parts.push(
    circle(input.objInit.x, input.objInit.y, R_BALL, {
      fill: C.obj,
      stroke: C.inkSoft,
      "stroke-width": 0.001,
    }),
  );
  parts.push(
    circle(input.cueFinal.x, input.cueFinal.y, R_BALL, {
      fill: C.cue,
      stroke: C.inkSoft,
      "stroke-width": 0.001,
      opacity: 0.7,
    }),
  );
  if (input.objPocketed) {
    parts.push(
      circle(input.objFinal.x, input.objFinal.y, R_BALL * 0.6, { fill: C.pot, opacity: 0.9 }),
    );
  } else {
    parts.push(
      circle(input.objFinal.x, input.objFinal.y, R_BALL * 0.5, {
        fill: "none",
        stroke: C.miss,
        "stroke-width": 0.0015,
      }),
    );
  }

  // ghost 标记（十字）
  parts.push(
    el("g", { transform: `translate(${ghost.x.toFixed(4)}, ${ghost.y.toFixed(4)})` }, [
      line(-0.008, 0, 0.008, 0, { stroke: C.predict, "stroke-width": 0.0015, opacity: 0.5 }),
      line(0, -0.008, 0, 0.008, { stroke: C.predict, "stroke-width": 0.0015, opacity: 0.5 }),
    ]),
  );

  return parts.join("\n");
}

/** 整台面的最终 SVG */
export function tableSvg(inner: string, geom: TableGeom): string {
  const pad = C_RAIL;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${geom.width + pad * 2} ${geom.height + pad * 2}" width="${Math.round(SIZE.width)}">${inner}</svg>`;
}
