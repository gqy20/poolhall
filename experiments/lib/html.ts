/**
 * HTML 页面生成（docs/visualization.md §4：首屏主图 + 回放卡格 + 账本）
 * 纯函数：JSONL rows → 单文件 HTML 字符串（数据内嵌，零外部依赖）。
 */
import { C, FONT, PAGE_CSS } from "./style.ts";
import { circle, el, line, polyline, svg, text } from "./svg.ts";
import { shotCardSvg, type TableGeom, tableBase } from "./table-svg.ts";

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

export interface ShotRow {
  kind: string;
  trial: number;
  optimal?: number | null;
  intentAngle?: number;
  intentPower?: number;
  actualAngle?: number;
  actualPower?: number;
  biasAt?: number;
  pot?: boolean;
  pottedPocket?: string | null;
  finalBalls?: Record<string, { x: number; y: number }>;
  samples?: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>;
  events?: Array<{
    t: number;
    kind: string;
    a: string;
    b?: string;
    pocket?: string;
    cushion?: string;
  }>;
}

export interface MetaRow {
  kind: string;
  agent?: string;
  seed?: number;
  trials?: number;
  promptVersion?: string;
  biasOverride?: number | null;
}

type Row = ShotRow | MetaRow;

const isShot = (r: Row): r is ShotRow => r.kind === "shot";

function angNorm(d: number): number {
  return ((d + 180) % 360) - 180;
}

function rolling(xs: number[], w: number): number[] {
  return xs.map((_, i) => {
    const slice = xs.slice(Math.max(0, i - w + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 迷你 sparkline SVG（无色块，极细轴线，左右刻度） */
function sparklineSvg(
  xs: number[],
  ys: number[],
  opts: { width: number; height: number; stroke: string; title?: string; maxY?: number },
): string {
  const { width, height, stroke } = opts;
  const pad = 22;
  const maxX = Math.max(1, ...xs);
  const maxY = Math.max(1e-6, ...(opts.maxY ? [opts.maxY] : []), ...ys.map((y) => Math.abs(y)));
  const px = (x: number): number => pad + (x / maxX) * (width - pad * 2);
  const py = (y: number): number => height - pad - (y / maxY) * (height - pad * 2);
  const pts = xs.map((x, i) => [px(x), py(ys[i]!)] as [number, number]);
  const parts: string[] = [
    // 零线
    line(pad, py(0), width - pad, py(0), { stroke: C.grid, "stroke-width": 1 }),
    // y 轴
    line(pad, pad, pad, height - pad, { stroke: C.grid, "stroke-width": 1 }),
    polyline(pts, {
      stroke,
      "stroke-width": 1.4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ];
  // 右端点值标注
  if (ys.length > 0) {
    parts.push(
      text(width - pad + 4, py(ys[ys.length - 1]!) + 4, ys[ys.length - 1]!.toFixed(2), {
        "font-size": 11,
        fill: C.inkSoft,
        "font-family": FONT.mono,
      }),
    );
  }
  return svg({ width, height, viewBox: `0 0 ${width} ${height}` }, parts);
}

/** 单杆台面小卡（轨迹 + 意图线 + 预测线） */
function trialCardSvg(shot: ShotRow): string {
  if (!shot.samples || shot.samples.length === 0) return "";
  const cueSamples = shot.samples.map((s) => s.pos["cue"]).filter(Boolean);
  const objSamples = shot.samples.map((s) => s.pos["1"] ?? s.pos["obj"]).filter(Boolean);
  const cueInit = shot.samples[0]?.pos["cue"] ?? { x: 0, y: 0 };
  const objInit = shot.samples[0]?.pos["1"] ?? shot.samples[0]?.pos["obj"] ?? { x: 0, y: 0 };
  const objFinal = shot.finalBalls?.["1"] ?? shot.finalBalls?.["obj"] ?? objInit;
  const cueFinal = shot.finalBalls?.["cue"] ?? cueInit;
  const pocket = TABLE_GEOM.pockets.find((p) => p.id === shot.pottedPocket);
  const pot = Boolean(shot.pot);

  const inner = shotCardSvg(
    {
      trial: shot.trial ?? 0,
      cueInit,
      objInit,
      pocketId: shot.pottedPocket ?? "?",
      pocketCenter: pocket?.center ?? { x: 0, y: 0 },
      pocketR: pocket?.r ?? 0.059,
      intentAngle: shot.intentAngle ?? 0,
      actualAngle: shot.actualAngle ?? 0,
      optimal: shot.optimal ?? null,
      pot,
      cueSamples,
      objSamples,
      cueFinal,
      objFinal,
      objPocketed: pot,
    },
    TABLE_GEOM,
  );
  return svg({ viewBox: "-0.05 -0.05 2.08 1.10", width: 380 }, [inner]);
}

function pct(n: number, d = 1): string {
  return n.toFixed(d);
}

export function renderHtml(rows: Row[]): string {
  const meta = rows.find((r) => r.kind === "meta") as MetaRow | undefined;
  const shots = rows.filter(isShot);
  const agent = meta?.agent ?? "unknown";
  const seed = meta?.seed ?? 0;
  const trials = shots.length;

  // 汇总指标
  const errs = shots
    .filter((s) => typeof s.optimal === "number" && typeof s.actualAngle === "number")
    .map((s) => Math.abs(angNorm((s.actualAngle ?? 0) - (s.optimal ?? 0))));
  const comps = shots
    .filter((s) => typeof s.optimal === "number" && typeof s.intentAngle === "number")
    .map((s) => angNorm((s.intentAngle ?? 0) - (s.optimal ?? 0)));
  const pots = shots.filter((s) => s.pot).length;
  const medErr = median(errs);
  const rollErr = rolling(errs, 5);

  const sparkErr = sparklineSvg(
    shots.map((s) => s.trial ?? 0),
    rollErr,
    { width: 380, height: 120, stroke: C.actual, title: "知行曲线" },
  );
  const sparkComp = sparklineSvg(
    shots.map((s) => s.trial ?? 0),
    comps,
    { width: 380, height: 120, stroke: C.predict, title: "补偿曲线" },
  );

  // 杆卡列表
  const cards = shots
    .map((s) => {
      const pot = Boolean(s.pot);
      const err =
        typeof s.optimal === "number" && typeof s.actualAngle === "number"
          ? angNorm(s.actualAngle - s.optimal)
          : 0;
      return {
        id: `t${s.trial}`,
        pot,
        err,
        svg: trialCardSvg(s),
        intent: s.intentAngle ?? 0,
        actual: s.actualAngle ?? 0,
        opt: s.optimal ?? null,
        bias: s.biasAt ?? 0,
        pocket: s.pottedPocket,
      };
    })
    .map(
      (c) => `
      <div class="trial-card ${c.pot ? "pot" : "miss"}" id="card-${c.id}">
        <div class="trial-head"><b>#${c.id.slice(1)}</b><span>${c.pot ? `进袋 ${c.pocket}` : "未进"}</span></div>
        ${c.svg}
        <div class="miss-note">
          ${c.pot ? "" : `误差 ${c.err >= 0 ? "+" : ""}${c.err.toFixed(2)}°，bias ${c.bias >= 0 ? "+" : ""}${c.bias.toFixed(3)}°`}
        </div>
      </div>`,
    )
    .join("\n");

  // 嵌入数据（播放/hover 用）
  const embed = JSON.stringify({
    meta,
    shots: shots.map((s) => ({
      trial: s.trial,
      pot: s.pot,
      actualAngle: s.actualAngle,
      intentAngle: s.intentAngle,
      optimal: s.optimal,
      biasAt: s.biasAt,
      samples: s.samples,
    })),
  }).replaceAll("</", "<\\/");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PoolHall 回放 · ${agent} · seed ${seed}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<header>
  <h1>PoolHall · 校准回放</h1>
  <div class="meta">
    agent <b>${agent}</b> · seed <b>${seed}</b> · prompt <b>${meta?.promptVersion ?? "-"}</b>
    ${meta?.biasOverride !== null && meta?.biasOverride !== undefined ? ` · biasOverride ${meta.biasOverride}°` : ""}
  </div>
  <div class="kpi">
    <div><b>${pots}/${trials}</b><br/><span>进球</span></div>
    <div><b>${medErr.toFixed(2)}°</b><br/><span>|误差| 中位</span></div>
    <div><b>${(mean(rollErr.slice(-5)) ?? 0).toFixed(2)}°</b><br/><span>末窗均值（窗 5）</span></div>
    <div><b>${comps.length ? (Math.sign(comps[comps.length - 1]!) === 1 ? "+" : "") + pct(comps[comps.length - 1]!) : "0.0"}°</b><br/><span>末杆补偿量</span></div>
  </div>
</header>

<section class="grid">
  <div>
    <div class="table-frame" id="main-view">
      <div style="padding:18px;color:${C.feltLight};font-size:13px">点击任意杆卡查看大图回放</div>
    </div>
    <div class="legend">
      <span><i style="border-top-color:${C.predict}" class="line-dash"></i>预测（intent / ghost 参考）</span>
      <span><i style="border-top-color:${C.actual}" class="line-solid"></i>实际（母球轨迹）</span>
      <span><i style="border-top-color:${C.miss}" class="line-solid"></i>未进目标球轨迹</span>
    </div>
    <div class="trial-list">${cards}</div>
  </div>

  <aside>
    <div class="curve-panel">
      <h3>知行曲线（|actual − optimal|，滑动窗 5）</h3>
      ${sparkErr}
    </div>
    <div class="curve-panel">
      <h3>补偿曲线（intent − optimal）</h3>
      ${sparkComp}
    </div>
    <div class="curve-panel">
      <h3>说明</h3>
      <div style="font-size:12px;color:${C.inkSoft};line-height:1.6">
        <p>虚线＝ agent 想打的方向；实线＝ 母球真实轨迹。两条线分开的那一刻，
        就是它的手背叛了它的瞬间。</p>
        <p style="margin-top:8px">砖红边 = 未进；墨绿边 = 进球。hover 卡片可快进帧。</p>
      </div>
    </div>
  </aside>
</section>

<script type="application/json" id="poolhall-data">${embed}</script>
<script>
(function(){
  const data = JSON.parse(document.getElementById('poolhall-data').textContent);
  const main = document.getElementById('main-view');
  if(!main) return;
  const viewBox = "-0.05 -0.05 2.08 1.10";
  function renderTrial(s){
    if(!s.samples || s.samples.length<2) return;
    const cue = s.samples.map(f=>f.pos.cue).filter(Boolean);
    const obj = s.samples.map(f=>f.pos['1']).filter(Boolean);
    const pot = s.pot;
    const html = window.__frame(cue, obj, pot);
    main.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+viewBox+'" style="width:100%;height:auto;display:block">'+html+'</svg>';
  }
  // 静态渲染（无逐帧动画的 v1）
  window.__frame = function(cue, obj, pot){
    return (
      '<polyline points="'+cue.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(' ')+'" fill="none" stroke="${C.actual}" stroke-width="0.003" stroke-linecap="round"/>' +
      '<polyline points="'+obj.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(' ')+'" fill="none" stroke="'+(pot?'${C.pot}':'${C.miss}')+'" stroke-width="0.0025"/>'
    );
  };
  document.querySelectorAll('.trial-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const id = card.id.replace('card-','t');
      const shot = data.shots.find(s=>String('t'+s.trial)===id);
      if(shot) renderTrial(shot);
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
})();
</script>
</body>
</html>`;
}
