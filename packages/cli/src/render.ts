/**
 * ASCII 球桌渲染器（docs/cli.md §6：调试即用的物理可视化）
 * 80×40 标准终端；球用字母/符号，pocketed 球不画，尾迹可选。
 */

import type { Ball, MotionEvent, Sample, Table } from "@poolhall/engine";

/** 渲染符号约定（快照测试锁定） */
const SYM = {
  rail: "█",
  pocket: "◌",
  cue: "●",
  empty: " ",
} as const;

const OBJECT_BALLS = "123456789ABCDEFGHIJKLMNOPQRST"; // 依次编号的彩球符号

export interface RenderOpts {
  /** 宽度（字符），默认 80；高度按台面纵横比折算（×0.5 字符高宽比） */
  width?: number;
  /** 叠加尾迹（来自 samples，最多取 200 个点） */
  trail?: Sample[];
  /** 尾迹符号 */
  trailSym?: string;
}

/** 单球快照渲染（80 列标准输出） */
export function renderTable(balls: Ball[], table: Table, opts: RenderOpts = {}): string {
  const W = opts.width ?? 80;
  // 字符高宽比 ≈ 2:1 → 台面格子数：列 = W-2（rail 占 2），行 = (W-2)·(h/w)·2
  const cols = W - 2;
  const rows = Math.round((cols * table.height * 2) / table.width);
  const grid: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill(SYM.empty));

  // 尾迹
  if (opts.trail) {
    const sym = opts.trailSym ?? "·";
    const pts = opts.trail.filter((_, i) => i % Math.ceil(opts.trail!.length / 200) === 0);
    for (const s of pts) {
      for (const id of Object.keys(s.pos)) {
        const cx = Math.round((s.pos[id]!.x / table.width) * (cols - 1));
        const cy = Math.round((s.pos[id]!.y / table.height) * (rows - 1));
        const row = grid[cy];
        if (row && cx >= 0 && cx < cols && row[cx] === SYM.empty) row[cx] = sym;
      }
    }
  }

  // 球（后画，覆盖尾迹）
  const symbols = new Map<string, string>();
  let objIdx = 0;
  for (const b of balls) {
    if (b.pocketed) continue;
    let sym: string;
    if (b.id === "cue") {
      sym = SYM.cue;
    } else if (/^[0-9]+$/.test(b.id) && OBJECT_BALLS[Number(b.id) - 1]) {
      sym = OBJECT_BALLS[Number(b.id) - 1]!;
    } else {
      sym = OBJECT_BALLS[objIdx % OBJECT_BALLS.length]!;
      objIdx++;
    }
    symbols.set(b.id, sym);
    const cx = Math.round((b.pos.x / table.width) * (cols - 1));
    const cy = Math.round((b.pos.y / table.height) * (rows - 1));
    const row = grid[cy];
    if (row && cx >= 0 && cx < cols) row[cx] = sym;
  }

  // 组装：rail 边框 + 袋口
  const lines: string[] = [];
  const top = SYM.rail.repeat(W);
  lines.push(top);
  for (let r = 0; r < rows; r++) {
    const row = grid[r]!;
    // 袋口标记：角袋在四角、中袋在上下边中点（画在 rail 行内侧不好做，直接在 rail 上开洞）
    lines.push(`${SYM.rail}${row.join("")}${SYM.rail}`);
  }
  lines.push(top);

  // 在边框上开袋口（替换 rail 字符）
  const out = lines.map((line, idx) => {
    if (idx === 0 || idx === lines.length - 1) {
      const chars = line.split("");
      const mid = Math.round(W / 2);
      if (idx === 0) {
        // 上边：角袋 lt/rt + 中袋 ct
        chars[1] = SYM.pocket;
        chars[W - 2] = SYM.pocket;
        chars[mid - 1] = SYM.pocket;
        chars[mid] = SYM.pocket;
      } else {
        chars[1] = SYM.pocket;
        chars[W - 2] = SYM.pocket;
        chars[mid - 1] = SYM.pocket;
        chars[mid] = SYM.pocket;
      }
      return chars.join("");
    }
    if (idx === 1 || idx === lines.length - 2) {
      const chars = line.split("");
      chars[0] = SYM.pocket;
      chars[W - 1] = SYM.pocket;
      return chars.join("");
    }
    return line;
  });

  // 图例
  const legend: string[] = [];
  for (const b of balls) {
    if (b.pocketed) {
      legend.push(`${b.id}:(pocketed ${b.pocket ?? "?"})`);
    } else {
      legend.push(`${b.id}:${symbols.get(b.id)}`);
    }
  }
  out.push("");
  out.push(legend.join(" "));
  return out.join("\n");
}

/** trace 模式：逐帧轨迹文本（事件挂在它之后的第一个采样帧行内） */
export function renderTrace(samples: Sample[], events: MotionEvent[], table: Table): string {
  const lines: string[] = [];
  // 每个采样帧收集 (t_sample, t_event] 内的事件
  let evIdx = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const tEnd = i + 1 < samples.length ? samples[i + 1]!.t : Number.POSITIVE_INFINITY;
    const posStr = Object.keys(s.pos)
      .sort()
      .map((id) => `${id}(${s.pos[id]!.x.toFixed(3)},${s.pos[id]!.y.toFixed(3)})`)
      .join(" ");
    lines.push(`t=${s.t.toFixed(2)}s  ${posStr}`);
    while (evIdx < events.length && events[evIdx]!.t <= tEnd) {
      const e = events[evIdx]!;
      const extra = e.b ?? e.cushion ?? e.pocket ?? "";
      lines.push(`    ⟶ ${e.kind} ${e.a} ${extra}`.trimEnd());
      evIdx++;
    }
  }
  void table;
  return lines.join("\n");
}
