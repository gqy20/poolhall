/**
 * 设计 tokens（docs/visualization.md §2/§3）——配色/字体/间距的唯一定义点
 * 改配色 = 改此文件，不动渲染逻辑。
 */

export const C = {
  paper: "#f7f4ee", // 浅纸质底
  paperLine: "#ece8dc", // 分隔线
  felt: "#1b4d3e", // 墨绿呢面
  feltLight: "#2a6b55", // 亮一点的绿（轨迹辅助）
  wood: "#7c4a18", // 木棕库边
  woodEdge: "#5d3a12", // 库边深描边
  pocket: "#121110", // 袋口黑
  ink: "#2b2b2b", // 主墨色（文字/轴线）
  inkSoft: "#5a5d61", // 次要文字
  grid: "#d6d0c4", // 网格线（轻）
  predict: "#2d5e8a", // 蓝墨 = 预测/意图（知行二元冷色）
  actual: "#d9730d", // 暖橙 = 实际（知行二元暖色）
  miss: "#b7402c", // 砖红 = 未进
  pot: "#1b4d3e", // 墨绿 = 进袋（同 felt 呼应）
  cue: "#ffffff", // 母球
  obj: "#ffc844", // 目标球（黄）
  hole: "#121110",
} as const;

export const FONT = {
  sans: `"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif`,
  mono: `"JetBrains Mono", "IBM Plex Mono", monospace`,
  display: `"Space Grotesk", "Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif`,
} as const;

export const SIZE = {
  width: 900, // 台面 SVG 最大宽度
  tableAspect: 1.9812 / 0.9906, // 7 尺台长宽比
} as const;

/** 全局 CSS（自包含；不复用框架） */
export const PAGE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${C.paper}; color: ${C.ink}; font-family: ${FONT.sans}; font-size: 14px; line-height: 1.5; }
a { color: ${C.predict}; }
header { padding: 20px 24px; border-bottom: 1px solid ${C.paperLine}; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
.meta { color: ${C.inkSoft}; font-size: 13px; }
.kpi { display: flex; gap: 24px; margin-top: 6px; }
.kpi b { font-family: ${FONT.mono}; font-size: 20px; font-weight: 600; }
.kpi span { color: ${C.inkSoft}; font-size: 12px; }
section { padding: 24px; max-width: 1180px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
.table-frame { background: ${C.felt}; border: 3px solid ${C.wood}; border-radius: 4px; padding: 8px; }
svg { display: block; width: 100%; height: auto; }
.legend { display: flex; gap: 16px; padding: 8px 0; font-size: 12px; color: ${C.inkSoft}; }
.legend i { display: inline-block; width: 14px; height: 2px; margin-right: 6px; vertical-align: middle; }
.legend .line-dash { border-top: 2px dashed; height: 0; width: 20px; }
.legend .line-solid { border-top: 2px solid; height: 0; width: 20px; }
.trial-list { margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.trial-card { background: #fff; border: 1px solid ${C.paperLine}; border-radius: 4px; padding: 12px; }
.trial-card.miss { border-left: 3px solid ${C.miss}; }
.trial-card.pot { border-left: 3px solid ${C.pot}; }
.trial-head { display: flex; justify-content: space-between; font-size: 12px; color: ${C.inkSoft}; margin-bottom: 6px; }
.trial-head b { font-family: ${FONT.mono}; }
table { border-collapse: collapse; width: 100%; font-family: ${FONT.mono}; font-size: 11px; }
th, td { text-align: right; padding: 2px 4px; }
th { font-weight: 400; color: ${C.inkSoft}; border-bottom: 1px solid ${C.paperLine}; }
td.num { font-variant-numeric: tabular-nums; }
.miss-note { font-size: 12px; color: ${C.miss}; margin-top: 4px; }
.curve-panel { background: #fff; border: 1px solid ${C.paperLine}; border-radius: 4px; padding: 12px; margin-bottom: 16px; }
.curve-panel h3 { margin: 0 0 8px; font-size: 12px; color: ${C.inkSoft}; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
`;
