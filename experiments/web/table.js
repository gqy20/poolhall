/* 观战核心（自 index.html 拆分）：场景渲染 · 轨迹回放 · 知行差距可视化 · 特效
 * 人类球杆层（human.js）经 globalThis.POOLHALL 命名空间消费本模块。 */
let TABLE_W = 2.54,
  TABLE_H = 1.27;
let BREAK_LINE_X = TABLE_W / 4,
  FOOT_SPOT_X = (TABLE_W * 3) / 4;
/* 袋口渲染半径 = 物理判定半径（hello 事件下发；老回放按 CHINESE_EIGHT 同值兜底） */
let POCKET_R_CORNER = 0.11811 / 2;
let POCKET_R_SIDE = 0.136525 / 2;
const R = 0.028575;
const CUE_LENGTH = 1.4;
const svgNS = "http://www.w3.org/2000/svg";
const kpi = { shot: 0, turn: "-", A: 0, B: 0 };
/** 已进袋球（按花色归属：1-7 全色 / 9-15 花色 / 8 黑）——台边球带数据源；不管谁打进的 */
const pottedGroups = { solids: [], stripes: [], eight: [] };
const embeddedEvents = globalThis.POOLHALL_EVENTS;
let playbackSpeed = Array.isArray(embeddedEvents) ? 4 : 1;
let paused = false;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const BALL_COLORS = {
  1: "#F2C230",
  2: "#2457A6",
  3: "#C83F3F",
  4: "#6A438C",
  5: "#E8872D",
  6: "#2F7D4A",
  7: "#8C2F3C",
  8: "#202124",
};

function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(svgNS, tag);
  setAttrs(n, attrs);
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, value);
  }
}

function ballSpec(id) {
  const number = Number(id);
  if (!Number.isInteger(number) || number < 1 || number > 15) return null;
  const colorNumber = number > 8 ? number - 8 : number;
  return { number, color: BALL_COLORS[colorNumber], stripe: number > 8 };
}

function createCueStick() {
  const group = el("g", { class: "cue-stick", display: "none" });
  const styles = [
    { stroke: "rgba(18,20,18,.28)", "stroke-width": 0.027 },
    { stroke: "#D6B47A", "stroke-width": 0.014 },
    { stroke: "#75452E", "stroke-width": 0.021 },
    { stroke: "var(--A)", "stroke-width": 0.023 },
    { stroke: "var(--A)", "stroke-width": 0.011 },
  ];
  for (const style of styles) {
    group.appendChild(el("line", { ...style, "stroke-linecap": "round" }));
  }
  return group;
}

function updateCueStick(group, cue, angle, playerColor) {
  if (!cue || !Number.isFinite(angle)) {
    group.setAttribute("display", "none");
    return;
  }
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad),
    dy = -Math.sin(rad);
  const point = (distance) => ({ x: cue.x - dx * distance, y: cue.y - dy * distance });
  const tipDistance = R + 0.012;
  const tip = point(tipDistance),
    joint = point(tipDistance + 0.86);
  const butt = point(tipDistance + CUE_LENGTH);
  const nearTip = point(tipDistance + 0.035),
    gripEnd = point(tipDistance + 1.08);
  const lines = group.querySelectorAll("line");
  setAttrs(lines[0], { x1: butt.x, y1: butt.y, x2: tip.x, y2: tip.y });
  setAttrs(lines[1], { x1: joint.x, y1: joint.y, x2: tip.x, y2: tip.y });
  setAttrs(lines[2], { x1: butt.x, y1: butt.y, x2: joint.x, y2: joint.y });
  setAttrs(lines[3], { x1: butt.x, y1: butt.y, x2: gripEnd.x, y2: gripEnd.y, stroke: playerColor });
  setAttrs(lines[4], { x1: nearTip.x, y1: nearTip.y, x2: tip.x, y2: tip.y, stroke: playerColor });
  setAttrs(group, { display: "inline", "aria-label": `球杆，瞄准 ${angle.toFixed(1)} 度` });
}

function createBallNode(id) {
  const group = el("g", { "data-ball-id": id, "data-ball-kind": id === "cue" ? "cue" : "object" });
  group.appendChild(
    el("line", {
      class: "motion-tail",
      display: "none",
      stroke: "rgba(235,242,238,.2)",
      "stroke-width": R * 0.7,
      "stroke-linecap": "round",
    }),
  );
  group.appendChild(
    el("ellipse", {
      cx: R * 0.12,
      cy: R * 0.16,
      rx: R * 0.92,
      ry: R * 0.7,
      fill: "rgba(8,18,14,.2)",
    }),
  );
  if (id === "cue") {
    group.appendChild(
      el("circle", {
        class: "ball-body",
        cx: 0,
        cy: 0,
        r: R,
        fill: "#FAFAF7",
        stroke: "#343A3D",
        "stroke-width": 0.0025,
      }),
    );
    group.appendChild(
      el("circle", { cx: -R * 0.3, cy: -R * 0.32, r: R * 0.18, fill: "rgba(255,255,255,.72)" }),
    );
    return group;
  }
  const spec = ballSpec(id);
  if (!spec) return group;
  const clipId = `ball-clip-${id}`;
  group.setAttribute("data-ball-kind", spec.stripe ? "stripe" : "solid");
  group.appendChild(el("clipPath", { id: clipId }, [el("circle", { cx: 0, cy: 0, r: R })]));
  group.appendChild(
    el("circle", {
      class: "ball-body",
      cx: 0,
      cy: 0,
      r: R,
      fill: spec.stripe ? "#F7F7F2" : spec.color,
    }),
  );
  if (spec.stripe) {
    group.appendChild(
      el("rect", {
        class: "ball-stripe",
        x: -R,
        y: -R * 0.42,
        width: R * 2,
        height: R * 0.84,
        fill: spec.color,
        "clip-path": `url(#${clipId})`,
      }),
    );
  }
  group.appendChild(
    el("circle", {
      cx: 0,
      cy: 0,
      r: R,
      fill: "none",
      stroke: "rgba(20,24,22,.62)",
      "stroke-width": 0.0025,
    }),
  );
  group.appendChild(
    el("circle", {
      class: "ball-number",
      cx: 0,
      cy: 0,
      r: R * 0.5,
      fill: "#FAFAF7",
      stroke: "rgba(20,24,22,.2)",
      "stroke-width": 0.001,
    }),
  );
  group.appendChild(
    el(
      "text",
      {
        x: 0,
        y: R * 0.27,
        "text-anchor": "middle",
        "font-size": spec.number >= 10 ? 0.018 : 0.021,
        fill: "#171918",
        "font-weight": 750,
      },
      [id],
    ),
  );
  return group;
}

function updateBallNode(group, p) {
  group.setAttribute("transform", `translate(${p.x} ${p.y})`);
  group.setAttribute("display", "inline");
  const tail = group.querySelector(".motion-tail");
  const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
  if (speed <= 0.15) {
    tail.setAttribute("display", "none");
    return;
  }
  const trail = Math.min(R * 1.5, speed * 0.009);
  const ux = p.vx / speed,
    uy = p.vy / speed;
  setAttrs(tail, {
    display: "inline",
    x1: -ux * trail,
    y1: -uy * trail,
    x2: -ux * R * 0.3,
    y2: -uy * R * 0.3,
  });
}

const scene = { root: null, cue: null, ballLayer: null, balls: new Map() };

/** 袋口角（knuckle）位置：开口两端的胶边球头（视觉装饰，不影响物理判定） */
function pocketJaws(p, pr, W, H) {
  switch (p.id) {
    case "lt":
      return [
        { x: pr, y: 0 },
        { x: 0, y: pr },
      ];
    case "rt":
      return [
        { x: W - pr, y: 0 },
        { x: W, y: pr },
      ];
    case "lb":
      return [
        { x: pr, y: H },
        { x: 0, y: H - pr },
      ];
    case "rb":
      return [
        { x: W - pr, y: H },
        { x: W, y: H - pr },
      ];
    case "ct":
      return [
        { x: W / 2 - pr, y: 0 },
        { x: W / 2 + pr, y: 0 },
      ];
    default:
      return [
        { x: W / 2 - pr, y: H },
        { x: W / 2 + pr, y: H },
      ];
  }
}

function createScene() {
  const root = el("svg", {
    viewBox: `0 0 ${TABLE_W} ${TABLE_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "中式八球球台",
  });
  root.appendChild(
    el("rect", { x: 0, y: 0, width: TABLE_W, height: TABLE_H, fill: "var(--felt)" }),
  );
  root.appendChild(
    el("line", {
      class: "break-line",
      x1: BREAK_LINE_X,
      y1: 0.04,
      x2: BREAK_LINE_X,
      y2: TABLE_H - 0.04,
      stroke: "rgba(247,244,238,.2)",
      "stroke-width": 0.003,
      "stroke-dasharray": "0.018 0.018",
    }),
  );
  root.appendChild(
    el("circle", {
      class: "foot-spot",
      cx: FOOT_SPOT_X,
      cy: TABLE_H / 2,
      r: 0.006,
      fill: "rgba(247,244,238,.35)",
    }),
  );
  const pockets = [
    { id: "lt", x: 0, y: 0 },
    { id: "rt", x: TABLE_W, y: 0 },
    { id: "lb", x: 0, y: TABLE_H },
    { id: "rb", x: TABLE_W, y: TABLE_H },
    { id: "ct", x: TABLE_W / 2, y: 0 },
    { id: "cb", x: TABLE_W / 2, y: TABLE_H },
  ];
  for (const p of pockets) {
    const pr = p.id.startsWith("c") ? POCKET_R_SIDE : POCKET_R_CORNER;
    // 袋口：细环（半径 = 物理判定圆）+ 两侧袋口角；袋位文字直接显示，无底色
    root.appendChild(
      el("circle", {
        cx: p.x,
        cy: p.y,
        r: pr,
        fill: "rgba(11,20,16,.35)",
        stroke: "rgba(247,244,238,.4)",
        "stroke-width": 0.0025,
      }),
    );
    for (const j of pocketJaws(p, pr, TABLE_W, TABLE_H)) {
      root.appendChild(
        el("circle", {
          class: "pocket-jaw",
          cx: j.x,
          cy: j.y,
          r: pr * 0.24,
          fill: "#12372A",
          stroke: "rgba(247,244,238,.3)",
          "stroke-width": 0.0018,
        }),
      );
    }
    root.appendChild(
      el(
        "text",
        {
          x: p.x,
          y: p.y + pr * 0.32,
          "text-anchor": "middle",
          "font-size": pr * 0.66,
          fill: "var(--felt-light)",
        },
        [p.id.toUpperCase()],
      ),
    );
  }
  scene.cue = createCueStick();
  scene.ballLayer = el("g", { class: "ball-layer" });
  scene.balls = new Map(); // 新场景必须清空旧球缓存（旧节点已随 root 脱离 DOM）
  scene.aim = el("g", { class: "aim-layer" });
  scene.fx = el("g", { class: "fx-layer" });
  scene.pockets = {};
  for (const p of pockets) scene.pockets[p.id] = { x: p.x, y: p.y };
  root.appendChild(scene.aim);
  root.appendChild(scene.cue);
  root.appendChild(scene.ballLayer);
  root.appendChild(scene.fx);
  scene.root = root;
  tableFrame.style.aspectRatio = String(TABLE_W / TABLE_H); // 与台尺寸一致，消除 letterbox 边缘间隙
  tableFrame.replaceChildren(root);
}

function updateScene(positions, playerColor, cueAngle) {
  if (!scene.root) createScene();
  updateCueStick(scene.cue, positions?.cue, cueAngle, playerColor);
  const live = new Set(Object.keys(positions ?? {}));
  for (const [id, p] of Object.entries(positions ?? {})) {
    let group = scene.balls.get(id);
    if (!group) {
      group = createBallNode(id);
      scene.balls.set(id, group);
      scene.ballLayer.appendChild(group);
    }
    updateBallNode(group, p);
    group.__p = p;
    if (id === "cue") lastCuePos = p;
  }
  for (const [id, group] of scene.balls) {
    if (!live.has(id) && !tweening.has(id)) group.setAttribute("display", "none");
  }
}

function setKpi() {
  document.getElementById("kpi-shot").textContent = kpi.shot;
  document.getElementById("kpi-turn").textContent = kpi.turn;
  document.getElementById("kpi-A").textContent = kpi.A;
  document.getElementById("kpi-B").textContent = kpi.B;
}

/* 已进袋球带：按花色归属展示（1-7 全色 / 9-15 花色 / 8 黑居中） */
function pottedChip(id) {
  const spec = ballSpec(id);
  if (!spec) return null;
  const chip = document.createElement("span");
  chip.className = `potted-chip ${id === "8" ? "eight" : spec.stripe ? "stripe" : "solid"}`;
  chip.style.setProperty("--c", spec.color);
  chip.textContent = id;
  return chip;
}

function renderPottedStrip() {
  const solids = document.getElementById("potted-balls-A");
  const stripes = document.getElementById("potted-balls-B");
  const eight = document.getElementById("potted-balls-8");
  solids.replaceChildren(...pottedGroups.solids.map((id) => pottedChip(id)).filter(Boolean));
  stripes.replaceChildren(...pottedGroups.stripes.map((id) => pottedChip(id)).filter(Boolean));
  eight.replaceChildren(...pottedGroups.eight.map((id) => pottedChip(id)).filter(Boolean));
}

function appendLog(by, text, cls) {
  const empty = logEl.querySelector(".placeholder");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `log-entry ${by}${cls ? ` ${cls}` : ""}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = by;
  const tx = document.createElement("span");
  tx.className = cls || "";
  tx.textContent = text;
  div.appendChild(who);
  div.appendChild(tx);
  logEl.prepend(div);
  logEl.scrollTop = 0;
}

function resultLabel(shot) {
  if (shot.scratch) return "母球进袋";
  if (shot.foul) return `犯规：${shot.foul}`;
  if (shot.pottedBalls?.length > 0) return `进袋：${shot.pottedBalls.join("/")}`;
  return "未进";
}

function renderPublicPlan(shot) {
  const plan = shot.publicPlan;
  aiPhase.className = "ai-phase";
  aiPhase.textContent = `${shot.by} 计划已生成`;
  planObservation.textContent = plan?.observation ?? "本杆没有公开观察摘要";
  planChoice.textContent =
    plan?.choice ?? `${shot.targetBall ?? "?"} 号球 → ${shot.targetPocket ?? "未指定袋"}`;
  planCue.textContent = plan?.cuePlan ?? `力度 ${(shot.intentPower ?? 0).toFixed(2)}`;
  planRisk.textContent = plan?.risk ?? "未记录风险判断";
  const confidence = { low: "低", medium: "中", high: "高" }[plan?.confidence] ?? "未标注";
  planConfidence.innerHTML = `<span class="confidence"><i></i>${confidence}</span>`;
  planReview.textContent = "结束后复盘";
}

async function renderShot(s, generation) {
  const displayShot = s.trial + 1;
  kpi.shot = displayShot;
  kpi.turn = s.by;
  setKpi();
  status.textContent = `▶ ${s.by} 正在击第 ${displayShot} 杆`;
  lastEventEl.textContent = `第 ${displayShot} 杆 · ${s.by} 正在执行计划`;
  const spinStr = s.intentSpin
    ? ` spin(${s.intentSpin.x.toFixed(2)},${s.intentSpin.y.toFixed(2)},${s.intentSpin.z.toFixed(2)})`
    : "";
  lastEventDetail.textContent = `${s.targetBall ?? "?"}→${s.targetPocket ?? "?"} 瞄 ${(s.intentAngle ?? 0).toFixed(1)}° 力 ${(s.intentPower ?? 0).toFixed(2)}${spinStr}`;
  renderPublicPlan(s);
  document.querySelector(".ai-panel")?.classList.remove("pulse");
  void document.querySelector(".ai-panel")?.offsetWidth;
  document.querySelector(".ai-panel")?.classList.add("pulse");
  await animateShot(s);
  if (generation !== playbackGeneration) return;
  if (s.pottedBalls?.length > 0) {
    if (s.by === "A") kpi.A += s.pottedBalls.length;
    else kpi.B += s.pottedBalls.length;
    for (const id of s.pottedBalls) {
      if (id === "8") pottedGroups.eight.push(id);
      else if (Number(id) <= 7) pottedGroups.solids.push(id);
      else pottedGroups.stripes.push(id);
    }
    renderPottedStrip();
    if (!s.foul) {
      const balls = s.pottedBalls.join("、");
      if (lastPotBy === s.by) potStreak += 1;
      else {
        lastPotBy = s.by;
        potStreak = 1;
      }
      if (potStreak >= 2) {
        showCaption(
          `${names[s.by] ?? s.by} 连击 ×${potStreak}`,
          `连进 ${balls} 号球`,
          "streak",
          1300,
        );
      } else {
        showCaption(
          `⚫ ${balls} 号进袋`,
          s.pottedPockets?.[0] ? `${s.pottedPockets[0].pocket.toUpperCase()} 袋` : "",
          "streak",
          1100,
        );
      }
    }
  } else if (!s.foul) {
    lastPotBy = null;
    potStreak = 0;
  }
  const label = resultLabel(s);
  const cls = s.scratch ? "miss" : s.foul ? "foul" : s.pottedBalls?.length > 0 ? "pot" : "";
  lastEventEl.textContent = `第 ${displayShot} 杆 · ${s.by} ${label}`;
  planReview.textContent = s.review;
  aiPhase.textContent = "已复盘";
  appendLog(
    s.by,
    `第${displayShot}杆 ${s.targetBall ?? "?"}→${s.targetPocket ?? "?"} 瞄${(s.intentAngle ?? 0).toFixed(0)}° ${label}`,
    cls,
  );
  kpi.turn = s.nextTurn;
  setKpi();
}

/**
 * 轨迹插值播放（samples 按 t 推进；rate 倍速可调）
 * - 30ms 帧步（≈33fps）
 * - 命中 / pocket 时该球在下一个 sample 就从 pos 中消失，做"消失"动画
 */
let animFrame = null;
let animResolve = null;
function cancelAnimation() {
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
  animResolve?.();
  animResolve = null;
}
function expandSamples(s) {
  const input = s.samples || [];
  if (s.sampleMode !== "delta-v1") {
    const removals = [];
    let prev = null;
    for (const f of input) {
      if (prev)
        for (const id of Object.keys(prev)) if (!(id in f.pos)) removals.push({ t: f.t, id });
      prev = f.pos;
    }
    return { frames: input, removals };
  }
  const state = {};
  const frames = [];
  const removals = [];
  for (const sample of input) {
    for (const id of sample.removed ?? []) {
      removals.push({ t: sample.t, id });
      delete state[id];
    }
    for (const [id, pos] of Object.entries(sample.pos)) state[id] = { x: pos.x, y: pos.y };
    frames.push({
      t: sample.t,
      pos: Object.fromEntries(Object.entries(state).map(([id, pos]) => [id, { ...pos }])),
    });
  }
  return { frames, removals };
}

function interpolateBalls(samples, targetT) {
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= targetT) lo = mid;
    else hi = mid;
  }
  const s0 = samples[lo],
    s1 = samples[hi];
  const f = (targetT - s0.t) / Math.max(1e-6, s1.t - s0.t);
  const dt = Math.max(1e-6, s1.t - s0.t);
  const liveBalls = {};
  for (const id of new Set([...Object.keys(s0.pos), ...Object.keys(s1.pos)])) {
    const a = s0.pos[id],
      b = s1.pos[id];
    if (a && b)
      liveBalls[id] = {
        x: a.x + f * (b.x - a.x),
        y: a.y + f * (b.y - a.y),
        vx: (b.x - a.x) / dt,
        vy: (b.y - a.y) / dt,
      };
    else if (a) liveBalls[id] = a;
    else if (b) liveBalls[id] = b;
  }
  return liveBalls;
}

/* ---------- 特效引擎 + 知行差距可视化 ---------- */
const tweening = new Set();
const FX = { items: [], raf: 0 };
const names = { A: "A", B: "B" };
let lastCuePos = null;
let lastPotBy = null;
let potStreak = 0;
let actCue = null,
  actObj = null,
  lastCuePt = null,
  lastObjPt = null;
const MOCKS = [
  "对手礼貌性地没有笑出声",
  "观众席传来一声轻咳",
  "母球表示想静静",
  "解说员沉默了两秒",
  "这一杆，收走了一颗白球",
  "掌声给了勇气，没给准度",
];

function fxAdd(item) {
  item.t0 = performance.now();
  FX.items.push(item);
  if (!FX.raf) FX.raf = requestAnimationFrame(fxFrame);
}
function fxFrame(now) {
  FX.items = FX.items.filter((it) => {
    const k = (now - it.t0 - (it.delay ?? 0)) / it.ms;
    if (k < 0) return true;
    const done = k >= 1;
    it.step(Math.min(1, k), now);
    if (done) it.end?.();
    return !done;
  });
  FX.raf = FX.items.length ? requestAnimationFrame(fxFrame) : 0;
}

function showCaption(main, sub, kind = "", ms = 1500) {
  captionEl.className = `caption ${kind}`;
  const esc = (t) => String(t).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const subs = Array.isArray(sub) ? sub : sub ? [sub] : [];
  captionEl.innerHTML = `<b>${esc(main)}</b>${subs.map((t) => `<span>${esc(t)}</span>`).join("")}`;
  void captionEl.offsetWidth;
  captionEl.classList.add("show");
  clearTimeout(captionEl.__t1);
  clearTimeout(captionEl.__t2);
  captionEl.__t1 = setTimeout(() => captionEl.classList.add("out"), Math.max(0, ms - 380));
  captionEl.__t2 = setTimeout(() => {
    captionEl.className = "caption";
  }, ms);
}

function shakeTable(hard) {
  tableFrame.classList.remove("shake", "shake-hard");
  void tableFrame.offsetWidth;
  tableFrame.classList.add(hard ? "shake-hard" : "shake");
}

function nearestPocket(p) {
  let best = "ct";
  let d0 = Infinity;
  for (const [id, c] of Object.entries(scene.pockets ?? {})) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < d0) {
      d0 = d;
      best = id;
    }
  }
  return best;
}

function rayLen(x, y, dx, dy, maxLen) {
  let t = maxLen;
  if (dx > 1e-9) t = Math.min(t, (TABLE_W - R - x) / dx);
  if (dx < -1e-9) t = Math.min(t, (x - R) / -dx);
  if (dy > 1e-9) t = Math.min(t, (TABLE_H - R - y) / dy);
  if (dy < -1e-9) t = Math.min(t, (y - R) / -dy);
  return Math.max(0, t);
}

function drawPrediction(s, startPos) {
  if (scene.aim) {
    scene.aim.replaceChildren();
    scene.aim.style.opacity = "1";
  }
  const cue = startPos?.cue;
  const rad = ((s.intentAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad),
    dy = -Math.sin(rad);
  if (cue && Number.isFinite(s.intentAngle)) {
    const len = rayLen(cue.x, cue.y, dx, dy, 1.9);
    if (len > 0.04) {
      scene.aim.appendChild(
        el("line", {
          class: "aim-pred",
          x1: cue.x + dx * R * 1.6,
          y1: cue.y + dy * R * 1.6,
          x2: cue.x + dx * (R * 1.6 + len),
          y2: cue.y + dy * (R * 1.6 + len),
        }),
      );
    }
  }
  const tb = s.targetBall;
  const pk = tb && s.targetPocket ? scene.pockets?.[s.targetPocket] : null;
  const tPos = tb ? startPos?.[tb] : null;
  if (tPos && pk) {
    scene.aim.appendChild(
      el("line", {
        class: "aim-pred aim-obj",
        x1: tPos.x,
        y1: tPos.y,
        x2: pk.x,
        y2: pk.y,
      }),
    );
  }
  actCue = el("polyline", { class: "aim-act" });
  scene.aim.appendChild(actCue);
  actObj = null;
  lastCuePt = null;
  lastObjPt = null;
  if (tb) {
    actObj = el("polyline", { class: "aim-act" });
    scene.aim.appendChild(actObj);
  }
}

function pushActual(live, s) {
  const push = (line, p, last) => {
    if (!line || !p) return last;
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.006) {
      line.__pts = `${line.__pts ?? ""}${p.x.toFixed(3)},${p.y.toFixed(3)} `;
      line.setAttribute("points", line.__pts);
      return p;
    }
    return last;
  };
  lastCuePt = push(actCue, live.cue, lastCuePt);
  lastObjPt = push(actObj, live[s.targetBall ?? ""], lastObjPt);
}

function fadeAimLater() {
  setTimeout(() => {
    if (scene.aim) scene.aim.style.opacity = "0";
  }, 1500);
}

/* 进球：袋口金圈闪光 + 球被吸入袋口 */
function potFlash(pocketId) {
  const pk = scene.pockets?.[pocketId];
  if (!pk || !scene.fx || reduceMotion) return;
  for (let i = 0; i < 2; i++) {
    const ring = el("circle", {
      class: "fx-pot",
      cx: pk.x,
      cy: pk.y,
      r: 0.03,
      fill: "none",
      stroke: "#E8B84B",
      "stroke-width": 0.005,
    });
    scene.fx.appendChild(ring);
    fxAdd({
      ms: 520 + i * 150,
      delay: i * 110,
      step: (k) => {
        ring.setAttribute("r", String(0.03 + k * (0.09 + i * 0.04)));
        ring.setAttribute("opacity", String(0.9 * (1 - k)));
      },
      end: () => ring.remove(),
    });
  }
  const glow = el("circle", { cx: pk.x, cy: pk.y, r: 0.05, fill: "#E8B84B", opacity: 0.5 });
  scene.fx.appendChild(glow);
  fxAdd({
    ms: 400,
    step: (k) => {
      glow.setAttribute("r", String(0.05 + k * 0.025));
      glow.setAttribute("opacity", String(0.5 * (1 - k)));
    },
    end: () => glow.remove(),
  });
}

function absorbBall(id, pocketId) {
  const group = scene.balls.get(id);
  const pk = scene.pockets?.[pocketId];
  if (!group || !pk || reduceMotion) return;
  const from = group.__p ?? pk;
  tweening.add(id);
  fxAdd({
    ms: 340,
    step: (k) => {
      const e = k * k;
      const x = from.x + (pk.x - from.x) * e;
      const y = from.y + (pk.y - from.y) * e;
      group.setAttribute("transform", `translate(${x} ${y}) scale(${1 - 0.72 * e})`);
      group.setAttribute("opacity", String(1 - 0.55 * e));
    },
    end: () => {
      group.setAttribute("display", "none");
      group.setAttribute("opacity", "1");
      tweening.delete(id);
    },
  });
}

/* 开球：接触点冲击波 + 震屏 + 字幕 */
function showBreakShock(x, y, by) {
  if (!scene.fx || reduceMotion) return;
  for (let i = 0; i < 3; i++) {
    const ring = el("circle", {
      cx: x,
      cy: y,
      r: 0.02,
      fill: "none",
      stroke: "rgba(247,244,238,.9)",
      "stroke-width": 0.005,
    });
    scene.fx.appendChild(ring);
    fxAdd({
      ms: 720,
      delay: i * 90,
      step: (k) => {
        ring.setAttribute("r", String(0.02 + k * (0.48 + i * 0.16)));
        ring.setAttribute("opacity", String(0.9 * (1 - k) * (1 - k)));
      },
      end: () => ring.remove(),
    });
  }
  shakeTable(false);
  showCaption("💥 开球", `${names[by] ?? by} 冲击球堆`, "break", 1200);
}

/* 白球进袋：全场暗场 + 袋口聚光灯 + 白球幽灵（画 × 眼）+ 嘲讽字幕 + 重震 */
function showScratchMock(s) {
  if (!scene.fx || reduceMotion) return;
  const pk = scene.pockets?.[nearestPocket(lastCuePos ?? { x: TABLE_W / 2, y: TABLE_H / 2 })];
  if (!pk) return;
  const dim = el("rect", {
    x: 0,
    y: 0,
    width: TABLE_W,
    height: TABLE_H,
    fill: "#0B1410",
    opacity: 0,
  });
  const pool = el("circle", { cx: pk.x, cy: pk.y, r: 0.17, fill: "#F5E6B8", opacity: 0 });
  const core = el("circle", { cx: pk.x, cy: pk.y, r: 0.07, fill: "#FFF6DE", opacity: 0 });
  const ghost = el("g", { opacity: 0 }, [
    el("circle", {
      cx: pk.x,
      cy: pk.y,
      r: R,
      fill: "#FAFAF7",
      stroke: "#343A3D",
      "stroke-width": 0.0025,
    }),
    el("line", {
      x1: pk.x - 0.007,
      y1: pk.y - 0.007,
      x2: pk.x + 0.007,
      y2: pk.y + 0.007,
      stroke: "#8C2F3C",
      "stroke-width": 0.003,
    }),
    el("line", {
      x1: pk.x + 0.007,
      y1: pk.y - 0.007,
      x2: pk.x - 0.007,
      y2: pk.y + 0.007,
      stroke: "#8C2F3C",
      "stroke-width": 0.003,
    }),
  ]);
  scene.fx.append(dim, pool, core, ghost);
  fxAdd({
    ms: 2300,
    step: (k, now) => {
      const inn = Math.min(1, k * 4);
      const out = Math.max(0, k * 4 - 3);
      dim.setAttribute("opacity", String(0.5 * inn * (1 - out)));
      const flick = 0.9 + 0.1 * Math.sin(now / 90);
      pool.setAttribute("opacity", String(0.22 * inn * flick * (1 - out)));
      core.setAttribute("opacity", String(0.38 * inn * (1 - out)));
      ghost.setAttribute(
        "opacity",
        String(inn * (k > 0.12 ? 0.5 + 0.5 * Math.sin(now / 160) : 1) * (1 - out)),
      );
    },
    end: () => {
      dim.remove();
      pool.remove();
      core.remove();
      ghost.remove();
    },
  });
  shakeTable(true);
  // 打脸字幕：引用 AI 自己刚说的原话（走位/风险优先——"低杆防 scratch"型发言最讽刺）
  const plan = s.publicPlan;
  const quote = plan
    ? [plan.cuePlan, plan.risk, plan.choice].find(
        (t) => t && !t.includes("外部选手") && t.trim().length > 3,
      )
    : null;
  const subs = quote
    ? [`它刚说：「${quote.slice(0, 60)}」`, MOCKS[s.trial % MOCKS.length]]
    : [MOCKS[s.trial % MOCKS.length]];
  showCaption("母球进袋", subs, "mock", quote ? 3000 : 2300);
}

/* 胜负：金色粒子爆发 + 字幕 */
function showVictory(winner, msg) {
  if (!scene.fx || reduceMotion) return;
  const cx = TABLE_W / 2,
    cy = TABLE_H / 2;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.13;
    const c = el("circle", { cx, cy, r: 0.012, fill: i % 3 ? "#E8B84B" : "#F5E6B8" });
    scene.fx.appendChild(c);
    fxAdd({
      ms: 950 + (i % 5) * 110,
      step: (k) => {
        const d = 0.08 + k * (0.72 + (i % 4) * 0.12);
        c.setAttribute("cx", String(cx + Math.cos(a) * d));
        c.setAttribute("cy", String(cy + Math.sin(a) * d * 0.62));
        c.setAttribute("opacity", String(1 - k));
      },
      end: () => c.remove(),
    });
  }
  const reason = (msg.reason ?? "").replaceAll("——", "：");
  showCaption(`🏆 ${names[winner] ?? winner} 胜`, reason, "victory", 2800);
}

function onRemoval(s, r) {
  if (r.id === "cue") {
    absorbBall(
      "cue",
      nearestPocket(scene.balls.get("cue")?.__p ?? { x: TABLE_W / 2, y: TABLE_H / 2 }),
    );
    return;
  }
  const pocketId = s.pottedPockets?.find((p) => p.ball === r.id)?.pocket;
  if (!pocketId) return;
  absorbBall(r.id, pocketId);
  potFlash(pocketId);
}

function detectBreak(live, by) {
  const cue = live.cue;
  if (!cue) return false;
  for (const [id, p] of Object.entries(live)) {
    if (id === "cue") continue;
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < 2 * R + 0.006) {
      showBreakShock(p.x, p.y, by);
      return true;
    }
  }
  return false;
}

function clearAimFx() {
  if (scene.aim) {
    scene.aim.replaceChildren();
    scene.aim.style.opacity = "1";
  }
  if (scene.fx) scene.fx.replaceChildren();
  for (const it of FX.items) it.end?.();
  FX.items = [];
  tweening.clear();
  lastPotBy = null;
  potStreak = 0;
  lastCuePos = null;
  captionEl.className = "caption";
}

function animateShot(s) {
  cancelAnimation();
  const samples = expandSamples(s);
  if (samples.frames.length < 2) {
    updateScene(s.finalBalls);
    return Promise.resolve();
  }
  if (reduceMotion) {
    updateScene(s.finalBalls);
    return Promise.resolve();
  }
  const t0 = samples.frames[0].t;
  const tEnd = samples.frames[samples.frames.length - 1].t;
  const dur = Math.max(1.5, Math.min(8, tEnd - t0));
  const cueHold = Array.isArray(embeddedEvents) ? 1200 : 850;
  let playbackMs = 0;
  let lastNow = performance.now();
  let broken = false;
  let removalIdx = 0;
  let scratchShown = false;
  const removals = samples.removals;
  // 球员色：A 蓝、B 橙；瞄准线虚色用同色
  const playerColor = s.by === "A" ? "var(--A)" : "var(--B)";
  drawPrediction(s, samples.frames[0].pos);

  return new Promise((resolve) => {
    animResolve = resolve;
    function frame() {
      const now = performance.now();
      const delta = now - lastNow;
      lastNow = now;
      if (paused) {
        animFrame = requestAnimationFrame(frame);
        return;
      }
      playbackMs += delta * playbackSpeed;
      if (playbackMs < cueHold) {
        updateScene(samples.frames[0].pos, playerColor, s.intentAngle);
        animFrame = requestAnimationFrame(frame);
        return;
      }
      const elapsed = (playbackMs - cueHold) / 1000;
      const tv = elapsed / dur;
      if (tv >= 1) {
        updateScene(s.finalBalls);
        fadeAimLater();
        if (s.scratch && !scratchShown) {
          scratchShown = true;
          showScratchMock(s);
        }
        animFrame = null;
        animResolve = null;
        resolve();
        return;
      }
      const targetT = t0 + tv * (tEnd - t0);
      const liveBalls = interpolateBalls(samples.frames, targetT);
      pushActual(liveBalls, s);
      updateScene(liveBalls, playerColor);
      if (!broken && s.trial === 0) broken = detectBreak(liveBalls, s.by);
      while (removalIdx < removals.length && removals[removalIdx].t <= targetT) {
        onRemoval(s, removals[removalIdx]);
        removalIdx++;
      }
      if (s.scratch && !scratchShown && !liveBalls.cue) {
        scratchShown = true;
        showScratchMock(s);
      }
      animFrame = requestAnimationFrame(frame);
    }
    animFrame = requestAnimationFrame(frame);
  });
}

let playback = Promise.resolve();
let playbackGeneration = 0;
let currentEvents = [];

/* 读人高光：金环凝视特效 + 字幕（心理层招牌时刻）；带推理时展示模型原文 */
function renderRead(msg, generation) {
  if (generation !== playbackGeneration) return;
  const readerName = names[msg.reader] ?? msg.reader;
  const dirText = msg.directionCorrect ? "方向读对" : "方向读错";
  const dirKind = msg.directionCorrect ? "✓" : "✗";
  showCaption(
    `👁 ${readerName} 读人：${msg.estimateDeg.toFixed(3)}°`,
    msg.rationale
      ? `${msg.rationale}`
      : `误差 ${msg.errorDeg.toFixed(3)}° · ${dirText} ${dirKind} · 剩余 ${msg.attemptsLeft} 次`,
    "read",
    3600,
  );
  if (!reduceMotion && scene.fx) {
    const cx = TABLE_W / 2,
      cy = TABLE_H / 2;
    // 金环双击：从中心扩散再回收（凝视的意象）
    for (let i = 0; i < 2; i++) {
      const ring = el("circle", {
        cx,
        cy,
        r: 0.06,
        fill: "none",
        stroke: i ? "#E8B84B" : "#F5E6B8",
        "stroke-width": 0.004,
        opacity: 0,
      });
      scene.fx.appendChild(ring);
      fxAdd({
        ms: 900,
        delay: i * 260,
        step: (k) => {
          const grow = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55;
          ring.setAttribute("r", String(0.06 + grow * 0.3));
          ring.setAttribute("opacity", String(0.85 * grow));
        },
        end: () => ring.remove(),
      });
    }
    // 眼睛意象：中心水平凝视线
    const gaze = el("line", {
      x1: cx - 0.22,
      y1: cy,
      x2: cx + 0.22,
      y2: cy,
      stroke: "#F5E6B8",
      "stroke-width": 0.0035,
      "stroke-linecap": "round",
      opacity: 0,
    });
    scene.fx.appendChild(gaze);
    fxAdd({
      ms: 700,
      delay: 200,
      step: (k) => {
        const inn = Math.min(1, k * 3);
        const out = Math.max(0, k * 3 - 2);
        gaze.setAttribute("x1", String(cx - 0.22 * inn * (1 - out * 0.6)));
        gaze.setAttribute("x2", String(cx + 0.22 * inn * (1 - out * 0.6)));
        gaze.setAttribute("opacity", String(0.9 * inn * (1 - out)));
      },
      end: () => gaze.remove(),
    });
  }
  appendLog(
    msg.reader,
    `读人：估 ${msg.estimateDeg.toFixed(3)}° → 误差 ${msg.errorDeg.toFixed(3)}°（${dirText}）`,
    msg.directionCorrect ? "pot" : "miss",
  );
  if (msg.rationale) {
    // 推理原文进 AI 思路面板（观众叙事）
    lastEventEl.textContent = `👁 ${readerName} 的读人推理`;
    lastEventDetail.textContent = msg.rationale;
    planReview.textContent = `估计 ${msg.estimateDeg.toFixed(3)}° → 服务端误差 ${msg.errorDeg.toFixed(3)}°（${dirText} ${dirKind}）`;
    document.querySelector(".ai-panel")?.classList.add("pulse");
    setTimeout(() => document.querySelector(".ai-panel")?.classList.remove("pulse"), 3600);
  }
}

function renderSummary(msg, generation) {
  if (generation !== playbackGeneration) return;
  const w = msg.winner === "A" ? "A 胜" : msg.winner === "B" ? "B 胜" : "平局";
  const color =
    msg.winner === "A" ? "var(--A)" : msg.winner === "B" ? "var(--B)" : "var(--ink-soft)";
  const reason = (msg.reason ?? "").replaceAll("——平局", "").replaceAll("——", "：");
  if (msg.winner && !reduceMotion) showVictory(msg.winner, msg);
  else showCaption(w, reason || "杆数耗尽", "victory", 2200);
  status.innerHTML = `<b style="color:${color}">${w}</b>${reason ? `：${reason}` : ""}（${msg.shots} 杆）`;
  aiPhase.textContent = "对局结束";
  replayButton.disabled = false;
}

function beginSession(msg) {
  playbackGeneration += 1;
  cancelAnimation();
  playback = Promise.resolve();
  paused = false;
  pauseButton.textContent = "Ⅱ";
  pauseButton.disabled = false;
  replayButton.disabled = true;
  kpi.shot = 0;
  kpi.turn = "-";
  kpi.A = 0;
  kpi.B = 0;
  pottedGroups.solids = [];
  pottedGroups.stripes = [];
  pottedGroups.eight = [];
  renderPottedStrip();
  setKpi();
  clearAimFx();
  lastEventEl.textContent = "—";
  lastEventDetail.textContent = "选择目标后展示计划";
  aiPhase.className = "ai-phase";
  aiPhase.textContent = "等待分析";
  planObservation.textContent = "—";
  planChoice.textContent = "—";
  planCue.textContent = "—";
  planRisk.textContent = "—";
  planConfidence.textContent = "—";
  planReview.textContent = "结束后复盘";
  const empty = document.createElement("div");
  empty.className = "placeholder";
  empty.textContent = "等首杆…";
  logEl.replaceChildren(empty);
  if (msg.maxShots) maxShotsInput.value = String(msg.maxShots);
}

function applyControlNotice(msg) {
  controlStatus.textContent = msg.message;
  const loading = ["starting", "thinking", "playing"].includes(msg.state);
  newMatchButton.disabled = loading || !socket || socket.readyState !== WebSocket.OPEN;
  maxShotsInput.disabled = loading;
  if (msg.state === "thinking") {
    aiPhase.className = "ai-phase thinking";
    aiPhase.textContent = msg.message;
    planReview.textContent = "分析局面中…";
  }
}

function handle(msg, record = true) {
  if (msg.type === "control") {
    applyControlNotice(msg);
    return;
  }
  if (record) {
    if (msg.type === "hello") currentEvents = [msg];
    else currentEvents.push(msg);
  }
  if (msg.type === "hello") {
    beginSession(msg);
    notifySession(msg);
    if (msg.table) {
      TABLE_W = msg.table.width;
      TABLE_H = msg.table.height;
      BREAK_LINE_X = msg.table.breakLineX;
      FOOT_SPOT_X = msg.table.footSpotX;
      if (msg.table.cornerMouth) POCKET_R_CORNER = msg.table.cornerMouth / 2;
      if (msg.table.sideMouth) POCKET_R_SIDE = msg.table.sideMouth / 2;
    }
    document.getElementById("meta").innerHTML =
      `seed <b>${msg.seed}</b> · <span class="A">A: ${msg.nameA}</span> vs <span class="B">B: ${msg.nameB}</span>` +
      (msg.promptA
        ? `<br/><span style="font-size:11px">promptA=${msg.promptA} · promptB=${msg.promptB}</span>`
        : "");
    names.A = msg.nameA || "A";
    names.B = msg.nameB || "B";
    renderPottedStrip();
    if (scene.root) createScene();
    status.textContent = "🔵 等首杆";
    updateScene(null);
    lastPotBy = null;
    potStreak = 0;
  } else if (msg.type === "shot") {
    const generation = playbackGeneration;
    playback = playback.then(() =>
      generation === playbackGeneration ? renderShot(msg, generation) : undefined,
    );
  } else if (msg.type === "read") {
    const generation = playbackGeneration;
    playback = playback.then(() =>
      generation === playbackGeneration ? renderRead(msg, generation) : undefined,
    );
  } else if (msg.type === "summary") {
    const generation = playbackGeneration;
    playback = playback.then(() => renderSummary(msg, generation));
  }
}

const status = document.getElementById("status");
const tableFrame = document.getElementById("table");
const captionEl = document.getElementById("caption");
const lastEventEl = document.getElementById("last-event");
const lastEventDetail = document.getElementById("last-event-detail");
const logEl = document.getElementById("log");
const stage = document.getElementById("stage");
const newMatchButton = document.getElementById("new-match");
const pauseButton = document.getElementById("pause-playback");
const replayButton = document.getElementById("replay-match");
const speedSelect = document.getElementById("playback-speed");
const maxShotsInput = document.getElementById("max-shots");
const fullscreenButton = document.getElementById("fullscreen-table");
const controlStatus = document.getElementById("control-status");
const aiPhase = document.getElementById("ai-phase");
const planObservation = document.getElementById("plan-observation");
const planChoice = document.getElementById("plan-choice");
const planCue = document.getElementById("plan-cue");
const planRisk = document.getElementById("plan-risk");
const planConfidence = document.getElementById("plan-confidence");
const planReview = document.getElementById("plan-review");
let socket = null;

function togglePause() {
  if (pauseButton.disabled) return;
  paused = !paused;
  pauseButton.textContent = paused ? "▶" : "Ⅱ";
  controlStatus.textContent = paused ? "已暂停" : "播放中";
  showFullscreenControls();
}

function replayCurrentMatch() {
  if (replayButton.disabled || currentEvents.length === 0) return;
  const events = [...currentEvents];
  for (const event of events) handle(event, false);
  controlStatus.textContent = "重新播放";
}

function requestNewMatch() {
  const maxShots = Number(maxShotsInput.value);
  if (!Number.isInteger(maxShots) || maxShots < 1 || maxShots > 120) {
    maxShotsInput.focus();
    controlStatus.textContent = "最大杆数需为 1–120";
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  newMatchButton.disabled = true;
  maxShotsInput.disabled = true;
  controlStatus.textContent = "新局准备中";
  socket.send(JSON.stringify({ type: "new_match", maxShots }));
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === stage) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    controlStatus.textContent = "浏览器不支持全屏";
  }
}

let fullscreenTimer = null;
function showFullscreenControls() {
  if (document.fullscreenElement !== stage) return;
  stage.classList.add("controls-visible");
  clearTimeout(fullscreenTimer);
  fullscreenTimer = setTimeout(() => {
    if (!stage.querySelector(".controls:focus-within") && !paused) {
      stage.classList.remove("controls-visible");
    }
  }, 1800);
}

newMatchButton.addEventListener("click", requestNewMatch);
pauseButton.addEventListener("click", togglePause);
replayButton.addEventListener("click", replayCurrentMatch);
speedSelect.addEventListener("change", () => {
  playbackSpeed = Number(speedSelect.value);
  controlStatus.textContent = `${speedSelect.value}× 播放`;
});
fullscreenButton.addEventListener("click", toggleFullscreen);
stage.addEventListener("pointermove", showFullscreenControls);
stage.addEventListener("keydown", showFullscreenControls);
document.addEventListener("fullscreenchange", () => {
  const active = document.fullscreenElement === stage;
  fullscreenButton.textContent = "⛶";
  fullscreenButton.title = active ? "退出全屏" : "全屏球桌";
  stage.classList.toggle("controls-visible", active);
  if (active && !fullscreenButton.matches(":focus-visible")) fullscreenButton.blur();
  if (active) showFullscreenControls();
});
document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  }
  if (event.key.toLowerCase() === "f") toggleFullscreen();
  if (event.key.toLowerCase() === "r") replayCurrentMatch();
});

function connectLive() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // 大厅模式（/table/<id>）：同源单端口 /ws/<id>；web-match 单桌模式：WS = HTTP 端口 - 1
  const lobbyTable = location.pathname.match(/^\/table\/([^/]+)/);
  if (lobbyTable) {
    socket = new WebSocket(`${proto}//${location.host}/ws/${lobbyTable[1]}`);
  } else {
    const wsPort = parseInt(location.port || "8788", 10) - 1;
    socket = new WebSocket(`${proto}//${location.hostname}:${wsPort}`);
  }
  socket.addEventListener("open", () => {
    status.textContent = "🟢 已连接";
    controlStatus.textContent = "已连接";
    newMatchButton.disabled = false;
  });
  socket.addEventListener("close", () => {
    status.textContent = "🔴 连接断开";
    controlStatus.textContent = "连接断开";
    newMatchButton.disabled = true;
  });
  socket.addEventListener("error", () => {
    status.textContent = "⚠️ 连接错误";
  });
  socket.addEventListener("message", (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.error("parse error", err);
    }
  });
}

if (Array.isArray(embeddedEvents)) {
  document.body.classList.add("offline");
  playbackSpeed = 4;
  speedSelect.value = "4";
  controlStatus.textContent = "离线回放";
  status.textContent = "▶ 正在播放离线回放";
  for (const event of embeddedEvents) handle(event);
} else {
  connectLive();
}
setKpi();

/* ---------- 跨模块命名空间：human.js（人类球杆层）消费 ---------- */
const sessionHooks = new Set();
function notifySession(msg) {
  for (const cb of sessionHooks) cb(msg);
}
globalThis.POOLHALL = {
  el,
  setAttrs,
  scene,
  R,
  updateScene,
  updateCueStick,
  pocketR: (id) => (id.startsWith("c") ? POCKET_R_SIDE : POCKET_R_CORNER),
  table: {
    get w() {
      return TABLE_W;
    },
    get h() {
      return TABLE_H;
    },
  },
  reduceMotion: () => reduceMotion,
  onSession: (cb) => {
    sessionHooks.add(cb);
    return () => sessionHooks.delete(cb);
  },
};
