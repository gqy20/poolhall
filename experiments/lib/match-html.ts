/**
 * 中式八球对局双视图 HTML 渲染器（experiments/render-match.ts 调用）
 *
 * 布局：
 * - 顶部：种子 + A/B 标签 + 总杆数 / 进球 / 犯规
 * - 中部：每杆一次"双方并排"——同一 shot trial，A 选择在上、B 选择在下
 *   每行三栏：选球→袋 | 瞄点 + 力度 + spin | 球台小图（轨迹+触球/触库/进袋高亮）
 * - 底部：双方各自的进球率/犯规次数对比
 *
 * 设计目标：让"看两个人比赛"这件事回到它该在的地方——
 * 同一台面、同一杆、两个不同的脑子。
 */
import { C, FONT, PAGE_CSS } from "./style.ts";
import { line, polyline, svg, text } from "./svg.ts";
import { shotCardSvg, type TableGeom } from "./table-svg.ts";

const TABLE_GEOM: TableGeom = {
  width: 1.9812,
  height: 0.9906,
  pockets: [
    { id: "lt", center: { x: 0, y: 0 }, r: 0.059 },
    { id: "rt", center: { x: 1.9812, y: 0 }, r: 0.059 },
    { id: "lb", center: { x: 0, y: 0.9906 }, r: 0.059 },
    { id: "rb", center: { x: 1.9812, y: 0.9906 }, r: 0.059 },
    { id: "ct", center: { x: 0.9906, y: 0 }, r: 0.068 },
    { id: "cb", center: { x: 0.9906, y: 0.9906 }, r: 0.068 },
  ],
};

export interface MatchShotRow {
  kind: "shot";
  shot: number;
  by: "A" | "B";
  targetBall?: string;
  targetPocket?: string;
  intentAngle?: number;
  intentPower?: number;
  intentSpin?: { x: number; y: number; z: number } | null;
  pottedBalls: string[];
  pottedPockets: Array<{ ball: string; pocket: string }>;
  scratch: boolean;
  firstContact: string | null;
  foul: string | null;
  nextTurn: "A" | "B";
  over: boolean;
  winner: "A" | "B" | null;
  reason: string | null;
  finalBalls: Record<string, { x: number; y: number }>;
}

export interface MatchMetaRow {
  kind: "meta";
  mode?: string;
  seed?: number;
  nameA?: string;
  nameB?: string;
  specA?: string;
  specB?: string;
  maxShots?: number;
}

type Row = MatchShotRow | MatchMetaRow;
const isShot = (r: Row): r is MatchShotRow => r.kind === "shot";

/** 同一 trial 由 A/B 各自的 shot 拼成（JSONL 按时序排列） */
interface TrialView {
  trial: number;
  by: "A" | "B";
  shot: MatchShotRow;
}

function pairShots(shots: MatchShotRow[]): TrialView[] {
  // 每杆只有一方出杆——按"双方各出一杆"组织：trial=1 时 A 击，trial=2 时 B 击...
  return shots.map((s) => ({ trial: s.shot, by: s.by, shot: s }));
}

function statusBadge(s: MatchShotRow): { text: string; color: string } {
  if (s.over && s.winner && s.by === s.winner) return { text: "终局·胜", color: C.pot };
  if (s.over && s.winner && s.by !== s.winner) return { text: "终局·负", color: C.miss };
  if (s.scratch) return { text: "母球进袋", color: C.miss };
  if (s.foul) return { text: `犯规：${s.foul ?? ""}`, color: C.miss };
  if (s.pottedBalls.length > 0) {
    const list = s.pottedPockets?.map((p) => p.ball).join("/") ?? s.pottedBalls.join("/");
    return { text: `进袋 ${list}`, color: C.pot };
  }
  return { text: "未进", color: C.inkSoft };
}

function smallTableSvg(s: MatchShotRow): string {
  if (!s.finalBalls) return "";
  // 用 shotCardSvg 渲染台面，但用 finalBalls 当 samples（静态终态）
  // 简化：直接在 finalBalls 上标各球位置
  const balls: Array<{ id: string; x: number; y: number }> = [];
  for (const [id, p] of Object.entries(s.finalBalls)) {
    balls.push({ id, x: p.x, y: p.y });
  }
  const cue = balls.find((b) => b.id === "cue");
  const objs = balls.filter((b) => b.id !== "cue" && b.id !== "8");
  const eight = balls.find((b) => b.id === "8");
  const pocket = TABLE_GEOM.pockets.find((p) => p.id === s.pottedPockets?.[0]?.pocket);

  const inner = shotCardSvg(
    {
      trial: s.shot,
      cueInit: cue ?? { x: 0.99, y: 0.5 },
      objInit: objs[0] ?? { x: 0.5, y: 0.5 },
      pocketId: s.pottedPockets?.[0]?.pocket ?? "?",
      pocketCenter: pocket?.center ?? { x: 0, y: 0 },
      pocketR: pocket?.r ?? 0.059,
      intentAngle: s.intentAngle ?? 0,
      actualAngle: s.intentAngle ?? 0,
      optimal: null,
      pot: s.pottedBalls.length > 0,
      cueSamples: cue ? [cue] : [],
      objSamples: objs[0] ? [objs[0]] : [],
      cueFinal: cue ?? { x: 0.99, y: 0.5 },
      objFinal: objs[0] ?? { x: 0.5, y: 0.5 },
      objPocketed: s.pottedBalls.length > 0,
    },
    TABLE_GEOM,
  );
  return svg({ viewBox: "-0.05 -0.05 2.08 1.10", width: 360 }, [inner]);
}

function trialRowHtml(a: TrialView | undefined, b: TrialView | undefined, t: number): string {
  const sa = a?.shot;
  const sb = b?.shot;
  const isOver = sa?.over || sb?.over;
  const ba = sa ? statusBadge(sa) : null;
  const bb = sb ? statusBadge(sb) : null;
  const cell = (side: "A" | "B" | null, t: TrialView | undefined, badge: { text: string; color: string } | null) => {
    if (!side || !t || !badge) {
      return `<td class="cell empty"></td>`;
    }
    const s = t.shot;
    const spin = s.intentSpin
      ? `spin(${s.intentSpin.x.toFixed(2)},${s.intentSpin.y.toFixed(2)},${s.intentSpin.z.toFixed(2)})`
      : "spin=0";
    const intent = s.intentAngle?.toFixed(1) ?? "—";
    const power = s.intentPower?.toFixed(2) ?? "—";
    return `
      <td class="cell">
        <div class="cell-head"><span class="name ${side}">${side}</span><span class="badge" style="color:${badge.color}">${badge.text}</span></div>
        <div class="cell-pick">打 <b>${s.targetBall ?? "?"}</b> → <b>${s.targetPocket ?? "?"}</b></div>
        <div class="cell-param">瞄 ${intent}° · 力 ${power} · ${spin}</div>
        <div class="cell-svg">${smallTableSvg(s)}</div>
      </td>`;
  };
  return `
    <tr class="trial-row ${isOver ? "over" : ""}">
      <td class="trial-num">${t}</td>
      ${cell("A", a, ba)}
      ${cell("B", b, bb)}
    </tr>`;
}

export function renderMatchHtml(rows: Row[], opts: { nameA?: string; nameB?: string } = {}): string {
  const meta = rows.find((r) => r.kind === "meta") as MatchMetaRow | undefined;
  const shots = rows.filter(isShot);
  const nameA = opts.nameA ?? meta?.nameA ?? "A";
  const nameB = opts.nameB ?? meta?.nameB ?? "B";
  const seed = meta?.seed ?? 0;

  // pair: 偶数 trial=A 击（按 match 规则 turn 交替），奇数 trial=B 击
  const paired: Array<[TrialView | undefined, TrialView | undefined, number]> = [];
  let lastT = 0;
  let va: TrialView | undefined;
  let vb: TrialView | undefined;
  for (const s of shots) {
    if (s.shot !== lastT) {
      if (va || vb) paired.push([va, vb, lastT]);
      va = undefined;
      vb = undefined;
      lastT = s.shot;
    }
    if (s.by === "A") va = { trial: s.shot, by: "A", shot: s };
    else vb = { trial: s.shot, by: "B", shot: s };
  }
  if (va || vb) paired.push([va, vb, lastT]);

  const aShots = shots.filter((s) => s.by === "A");
  const bShots = shots.filter((s) => s.by === "B");
  const aPots = aShots.filter((s) => s.pottedBalls.length > 0).length;
  const bPots = bShots.filter((s) => s.pottedBalls.length > 0).length;
  const aFouls = aShots.filter((s) => s.foul).length;
  const bFouls = bShots.filter((s) => s.foul).length;
  const aScratch = aShots.filter((s) => s.scratch).length;
  const bScratch = bShots.filter((s) => s.scratch).length;
  const winner = shots.at(-1)?.winner;
  const reason = shots.at(-1)?.reason;
  const totalShots = shots.length;

  const tableRows = paired.map(([a, b, t]) => trialRowHtml(a, b, t)).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PoolHall 中式八球对局 · seed ${seed}</title>
<style>
${PAGE_CSS}
.match-body{padding:24px;max-width:1280px;margin:0 auto}
.match-header{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px;gap:24px;flex-wrap:wrap}
.match-title{font-size:24px;margin:0 0 4px 0;color:${C.ink}}
.match-meta{font-size:13px;color:${C.inkSoft}}
.match-kpis{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px}
.match-kpi{background:${C.bgAlt};padding:10px 16px;border-radius:4px;min-width:120px}
.match-kpi b{font-size:22px;display:block;font-family:${FONT.mono};color:${C.ink}}
.match-kpi span{font-size:12px;color:${C.inkSoft}}
.match-table{width:100%;border-collapse:collapse;background:${C.bg};border:1px solid ${C.grid};border-radius:4px;overflow:hidden}
.match-table th{background:${C.bgAlt};padding:10px 14px;font-size:12px;text-align:left;color:${C.inkSoft};font-weight:600;border-bottom:1px solid ${C.grid}}
.match-table td{padding:0;vertical-align:top;border-top:1px solid ${C.grid}}
.match-table tr:first-child td{border-top:none}
.match-table tr.over{background:rgba(180,140,60,0.06)}
.trial-num{width:48px;text-align:center;font-family:${FONT.mono};font-size:18px;color:${C.inkSoft};background:${C.bgAlt};font-weight:700}
.cell{width:50%;padding:10px 14px;vertical-align:top}
.cell.empty{background:repeating-linear-gradient(45deg,${C.bgAlt},${C.bgAlt} 8px,${C.bg} 8px,${C.bg} 16px);opacity:0.4}
.cell-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px}
.cell-head .name{font-weight:700;font-size:14px}
.cell-head .name.A{color:${C.actual}}
.cell-head .name.B{color:#C76B2D}
.badge{font-size:11px;font-weight:600;letter-spacing:0.5px}
.cell-pick{font-size:14px;margin-bottom:4px;color:${C.ink}}
.cell-param{font-size:12px;color:${C.inkSoft};font-family:${FONT.mono};margin-bottom:8px}
.cell-svg svg{width:100%;max-width:360px;height:auto;display:block}
</style>
</head>
<body>
<div class="match-body">
  <div class="match-header">
    <div>
      <h1 class="match-title">PoolHall · 中式八球对局</h1>
      <div class="match-meta">seed <b>${seed}</b> · <span class="A" style="color:${C.actual};font-weight:700">A: ${nameA}</span> vs <span class="B" style="color:#C76B2D;font-weight:700">B: ${nameB}</span>${
    meta?.specA && meta?.specB ? ` · <span style="font-family:${FONT.mono};font-size:12px">${meta.specA} / ${meta.specB}</span>` : ""
  }</div>
    </div>
    <div class="match-meta">${
      winner === "A"
        ? `<b style="color:${C.actual}">${nameA} 胜</b>`
        : winner === "B"
          ? `<b style="color:#C76B2D">${nameB} 胜</b>`
          : winner === null
            ? "<b>平局</b>"
            : ""
    }${reason ? ` · <span style="font-size:12px">${reason}</span>` : ""}</div>
  </div>

  <div class="match-kpis">
    <div class="match-kpi"><b>${totalShots}</b><span>总杆数</span></div>
    <div class="match-kpi"><b style="color:${C.actual}">${aPots}</b><span>A 进球</span></div>
    <div class="match-kpi"><b style="color:#C76B2D">${bPots}</b><span>B 进球</span></div>
    <div class="match-kpi"><b style="color:${C.miss}">${aScratch + aFouls}</b><span>A 失误（scratch/犯规）</span></div>
    <div class="match-kpi"><b style="color:${C.miss}">${bScratch + bFouls}</b><span>B 失误</span></div>
  </div>

  <table class="match-table">
    <thead>
      <tr>
        <th class="trial-num">#</th>
        <th>${nameA}（A）</th>
        <th>${nameB}（B）</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>
</body>
</html>`;
}
