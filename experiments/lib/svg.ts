/**
 * SVG 最小构建器（无依赖，函数式标签 DSL）
 * 用法：el("line", { x1, y1, x2, y2, stroke: ... }) → "<line ... />"
 */

export const esc = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export interface Attrs {
  [k: string]: string | number | undefined;
}

/** 标签生成（children 为子标签数组或文本） */
export function el(tag: string, attrs: Attrs = {}, children: Array<string | null> = []): string {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
  const inner = children.filter((c): c is string => c !== null).join("");
  return inner ? `<${tag}${attrStr}>${inner}</${tag}>` : `<${tag}${attrStr}/>`;
}

/** 路径（路径用 d 参数直接生成） */
export const path = (d: string, attrs: Attrs = {}): string => el("path", { d, ...attrs });
export const line = (x1: number, y1: number, x2: number, y2: number, attrs: Attrs = {}): string =>
  el("line", { x1, y1, x2, y2, ...attrs });
export const circle = (cx: number, cy: number, r: number, attrs: Attrs = {}): string =>
  el("circle", { cx, cy, r, ...attrs });
export const text = (x: number, y: number, content: string, attrs: Attrs = {}): string =>
  el("text", { x, y, ...attrs }, [esc(content)]);
export const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  attrs: Attrs = {},
): string => el("rect", { x, y, width, height, ...attrs });

/** 折线/多边形（轨迹用） */
export function polyline(points: Array<[number, number]>, attrs: Attrs = {}): string {
  const pts = points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(" ");
  return el("polyline", { points: pts, fill: "none", ...attrs });
}

export const svg = (attrs: Attrs, children: string[]): string =>
  el("svg", { xmlns: "http://www.w3.org/2000/svg", ...attrs }, children);

/** 工具函数：把一串台面上的点串成折线 */
export const polyPoints = (pts: Array<{ x: number; y: number }>): Array<[number, number]> =>
  pts.map((p) => [p.x, p.y]);
