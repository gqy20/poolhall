/* 人类球杆层：浏览器直接入座打球（M7）
 *
 * 通道：POST /match/join 入座 → 轮询 /match/state 等回合 →
 *       拖拽瞄准/力度/击球点 → POST /match/preview 预演（纯物理，金线）→
 *       POST /match/shot 出杆（手感噪声在此注入，实际轨迹橙线）。
 * 金线（预演）vs 橙线（实际）：你自己的知行差距。
 * 离线回放（body.offline）无人类层。
 */
(() => {
  const P = globalThis.POOLHALL;
  if (!P) return;
  const R = P.R;
  const NAME_KEY = "poolhall.human.name";
  const NOISE_KEY = "poolhall.human.noise";
  const POLL_MS = 900;
  const SPIN_MAX = 0.8;

  const bar = document.getElementById("human-bar");
  const nameInput = document.getElementById("human-name");
  const joinButton = document.getElementById("human-join");
  const statusEl = document.getElementById("human-status");
  const angleEl = document.getElementById("human-angle");
  const cutEl = document.getElementById("human-cut");
  const powerInput = document.getElementById("human-power");
  const powerVal = document.getElementById("human-power-v");
  const snapButton = document.getElementById("human-snap");
  const autoButton = document.getElementById("human-auto");
  const spinDisk = document.getElementById("human-spin");
  const spinDot = document.getElementById("human-spin-dot");
  const spinDiskBig = document.getElementById("human-spin-big");
  const spinDotBig = document.getElementById("human-spin-dot-big");
  const spinRead = document.getElementById("spin-read");
  const noiseInput = document.getElementById("human-noise");
  const fireButton = document.getElementById("human-fire");
  const tableFrame = document.getElementById("table");

  const state = {
    name: "",
    seat: null,
    table: null,
    /** 桌页（/table/<id>）入座锁定本桌；大厅入口为 null（自动分配） */
    preferredTable: (location.pathname.match(/^\/table\/([^/]+)/) ?? [])[1] ?? null,
    joined: false,
    active: false,
    balls: [],
    aimAssists: [],
    breakShot: false,
    /** 自由球：上一杆 scratch，母球可拖放摆位 */
    ballInHand: false,
    /** 已确认的摆位（null = 用服务端默认重置位） */
    placedCue: null,
    /** 摆放拖拽中 */
    placing: false,
    /** 摆放起始位（不合法时还原用） */
    placingFrom: null,
    angle: 0,
    power: 0.5,
    spin: null,
    target: null,
    drag: null,
    previewTimer: 0,
    previewSeq: 0,
    inflight: null,
  };

  /* ---------- HTTP（大厅模式所有接口需 ?table=<id>；单桌模式无桌号字段则不带） ---------- */
  function withTable(path) {
    if (!state.table) return path;
    return `${path}${path.includes("?") ? "&" : "?"}table=${encodeURIComponent(state.table)}`;
  }

  async function api(path, body, signal) {
    const res = await fetch(
      withTable(path),
      body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
          }
        : undefined,
    );
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  function setStatus(text, long) {
    statusEl.textContent = text;
    statusEl.title = long ?? text; // 单行截断时悬停看全文
  }

  /* ---------- SVG 坐标 ---------- */
  function svgPoint(event) {
    const root = P.scene.root;
    const ctm = root?.getScreenCTM();
    if (!root || !ctm) return null;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  function cueBall() {
    return state.balls.find((b) => b.id === "cue") ?? null;
  }

  function pocketOf(id) {
    const pk = P.scene.pockets?.[id];
    return pk ? { x: pk.x, y: pk.y } : null;
  }

  function seatColor() {
    return state.seat === "B" ? "var(--B)" : "var(--A)";
  }

  function rayLen(x, y, dx, dy) {
    const W = P.table.w;
    const H = P.table.h;
    let t = 1.9;
    if (dx > 1e-9) t = Math.min(t, (W - R - x) / dx);
    if (dx < -1e-9) t = Math.min(t, (x - R) / -dx);
    if (dy > 1e-9) t = Math.min(t, (H - R - y) / dy);
    if (dy < -1e-9) t = Math.min(t, (y - R) / -dy);
    return Math.max(0, t);
  }

  /* ---------- 渲染层（球杆下方、球体上方） ---------- */
  let layer = null;
  let aimGroup = null;
  let previewGroup = null;

  function groups() {
    const root = P.scene.root;
    if (!root) return false;
    if (!layer || !root.contains(layer)) {
      layer = P.el("g", { class: "human-layer" });
      root.insertBefore(layer, P.scene.cue);
    }
    if (!aimGroup || !layer.contains(aimGroup)) {
      aimGroup = P.el("g", { class: "human-aim-group" });
      layer.appendChild(aimGroup);
    }
    if (!previewGroup || !layer.contains(previewGroup)) {
      previewGroup = P.el("g", { class: "human-preview-group" });
      layer.appendChild(previewGroup);
    }
    return true;
  }

  function drawAim() {
    if (!aimGroup) return;
    aimGroup.replaceChildren();
    if (!state.active) return;
    const cue = cueBall();
    if (!cue) return;
    const rad = (state.angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = -Math.sin(rad);
    const len = rayLen(cue.x, cue.y, dx, dy);
    if (len > 0.02) {
      aimGroup.appendChild(
        P.el("line", {
          class: "human-aim",
          x1: cue.x + dx * R * 1.2,
          y1: cue.y + dy * R * 1.2,
          x2: cue.x + dx * (len - R),
          y2: cue.y + dy * (len - R),
        }),
      );
    }
    const t = state.target;
    const ball = t ? state.balls.find((b) => b.id === t.ball) : null;
    const pk = t ? pocketOf(t.pocket) : null;
    if (t) {
      aimGroup.appendChild(
        P.el("circle", { class: "human-ghost", cx: t.ghost.x, cy: t.ghost.y, r: R }),
      );
    }
    if (ball && pk) {
      aimGroup.appendChild(
        P.el("line", {
          class: "human-ghostline",
          x1: ball.x,
          y1: ball.y,
          x2: pk.x,
          y2: pk.y,
        }),
      );
      aimGroup.appendChild(
        P.el("line", {
          class: "human-cutline",
          x1: ball.x,
          y1: ball.y,
          x2: cue.x,
          y2: cue.y,
        }),
      );
      cutEl.textContent = `${t.cutAngleDeg.toFixed(1)}°`;
    } else {
      cutEl.textContent = "—";
    }
    P.updateCueStick(P.scene.cue, cue, state.angle, seatColor());
  }

  /** 路径总长度（轨迹变化量） */
  function pathLength(pts) {
    let sum = 0;
    for (let i = 1; i < pts.length; i++) {
      sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return sum;
  }

  function drawPreview(pv) {
    if (!previewGroup) return;
    previewGroup.replaceChildren();
    if (!pv) return;
    // 轨迹收拢：母球 + 首触目标球（亮白突出）+ 其余球中变化最大的 3 颗（压暗）
    const firstContact = (pv.events ?? []).find(
      (e) => e.kind === "ball-ball" && (e.a === "cue" || e.b === "cue"),
    );
    const firstBall = firstContact
      ? firstContact.a === "cue"
        ? firstContact.b
        : firstContact.a
      : null;
    const others = Object.entries(pv.paths ?? {})
      .filter(([id, pts]) => id !== "cue" && id !== firstBall && pts.length >= 2)
      .map(([id, pts]) => [id, pts, pathLength(pts)])
      .sort((a, b) => b[2] - a[2]);
    const visible = new Set(["cue", firstBall, ...others.slice(0, 3).map(([id]) => id)]);
    for (const [id, pts] of Object.entries(pv.paths ?? {})) {
      if (!visible.has(id) || !Array.isArray(pts) || pts.length < 2) continue;
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      previewGroup.appendChild(
        P.el("polyline", {
          class:
            id === "cue" ? "human-path-cue" : id === firstBall ? "human-path-first" : "human-path",
          points,
        }),
      );
    }
    for (const e of pv.events ?? []) {
      if (e.kind === "ball-ball") {
        previewGroup.appendChild(
          P.el("circle", { class: "human-hit", cx: e.x, cy: e.y, r: 0.005 }),
        );
      }
    }
    for (const p of pv.pottedPockets ?? []) {
      const pk = pocketOf(p.pocket);
      if (pk)
        previewGroup.appendChild(
          P.el("circle", { class: "human-pot", cx: pk.x, cy: pk.y, r: R * 1.7 }),
        );
    }
    const cueStop = pv.finalPos?.cue;
    if (cueStop && !pv.scratch) {
      previewGroup.appendChild(
        P.el("circle", {
          class: "human-stop",
          cx: cueStop.x,
          cy: cueStop.y,
          r: R * 1.35,
        }),
      );
    }
    if (pv.scratch) {
      const end = (pv.paths?.cue ?? []).at(-1) ?? (cueStop ? [cueStop.x, cueStop.y] : null);
      if (end) {
        previewGroup.appendChild(
          P.el("g", { class: "human-scratch" }, [
            P.el("line", {
              x1: end[0] - 0.008,
              y1: end[1] - 0.008,
              x2: end[0] + 0.008,
              y2: end[1] + 0.008,
            }),
            P.el("line", {
              x1: end[0] + 0.008,
              y1: end[1] - 0.008,
              x2: end[0] - 0.008,
              y2: end[1] + 0.008,
            }),
          ]),
        );
      }
    }
  }

  /* ---------- 预演（防抖 + 中断旧请求） ---------- */
  function schedulePreview() {
    if (!state.active || !state.joined) return;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => void fetchPreview(), 140);
  }

  async function fetchPreview() {
    if (!state.active || !state.joined) return;
    const seq = ++state.previewSeq;
    state.inflight?.abort();
    const ac = new AbortController();
    state.inflight = ac;
    try {
      const { data } = await api(
        "/match/preview",
        {
          name: state.name,
          angle: state.angle,
          power: state.power,
          spin: state.spin ?? undefined,
          cue: state.placedCue ?? undefined,
        },
        ac.signal,
      );
      if (seq !== state.previewSeq || data?.ok !== true) return;
      drawPreview(data.preview);
    } catch {
      /* 中断/网络抖动：静默 */
    }
  }

  /* ---------- 瞄准交互 ---------- */
  function setAngle(angle) {
    state.angle = Math.round(angle * 10) / 10;
    angleEl.textContent = `${state.angle.toFixed(1)}°`;
    drawAim();
    schedulePreview();
  }

  function setAngleFrom(p) {
    const cue = cueBall();
    if (!cue) return;
    setAngle((Math.atan2(-(p.y - cue.y), p.x - cue.x) * 180) / Math.PI);
  }

  function setPower(v) {
    state.power = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    powerInput.value = String(state.power);
    powerVal.textContent = state.power.toFixed(2);
    schedulePreview();
  }

  function pointerBall(p) {
    let best = null;
    for (const b of state.balls) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < R * 1.8 && (!best || d < best.d)) best = { b, d };
    }
    return best?.b ?? null;
  }

  function onPointerDown(event) {
    if (!state.active) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const p = svgPoint(event);
    if (!p) return;
    const cue = cueBall();
    // 自由球：按住母球（3R 范围内）进入摆放模式
    if (state.ballInHand && cue && Math.hypot(p.x - cue.x, p.y - cue.y) < R * 3) {
      state.placing = true;
      state.placingFrom = { x: cue.x, y: cue.y };
      state.drag = null;
    } else {
      state.drag = { x: event.clientX, y: event.clientY, moved: false };
    }
    try {
      tableFrame.setPointerCapture(event.pointerId);
    } catch {
      /* 老浏览器 */
    }
  }

  function onPointerMove(event) {
    if (!state.active) return;
    if (state.placing) {
      const p = svgPoint(event);
      if (p) moveCueTo(p);
      return;
    }
    if (!state.drag) return;
    if (Math.hypot(event.clientX - state.drag.x, event.clientY - state.drag.y) > 7)
      state.drag.moved = true;
    if (!state.drag.moved) return;
    const p = svgPoint(event);
    if (p) setAngleFrom(p);
  }

  function onPointerUp(event) {
    if (state.placing) {
      state.placing = false;
      finishPlacement();
      return;
    }
    const drag = state.drag;
    state.drag = null;
    if (!drag || !state.active) return;
    if (drag.moved) return;
    const p = svgPoint(event);
    const ball = p ? pointerBall(p) : null;
    if (ball && ball.id !== "cue") {
      selectTarget(ball.id);
      return;
    }
    // 自由球：点空处直接落点
    if (state.ballInHand && p && !ball) tryPlaceCue(p);
  }

  /* ---------- 自由球摆放 ---------- */
  function cueSpotError(x, y) {
    if (x < R || x > P.table.w - R || y < R || y > P.table.h - R) return "越界";
    for (const b of state.balls) {
      if (b.id === "cue") continue;
      if (Math.hypot(b.x - x, b.y - y) < 2 * R - 1e-9) return `与 ${b.id} 号球重叠`;
    }
    for (const [id, pk] of Object.entries(P.scene.pockets ?? {})) {
      if (Math.hypot(pk.x - x, pk.y - y) < P.pocketR(id)) return "落在袋口区";
    }
    return null;
  }

  function moveCueTo(p) {
    const x = Math.min(P.table.w - R, Math.max(R, p.x));
    const y = Math.min(P.table.h - R, Math.max(R, p.y));
    const cue = cueBall();
    if (!cue) return;
    cue.x = x;
    cue.y = y;
    P.updateScene(Object.fromEntries(state.balls.map((b) => [b.id, { x: b.x, y: b.y }])));
    drawAim();
  }

  function tryPlaceCue(p) {
    const x = Math.min(P.table.w - R, Math.max(R, p.x));
    const y = Math.min(P.table.h - R, Math.max(R, p.y));
    const err = cueSpotError(x, y);
    if (err) {
      setStatus("位置不合法", `摆位失败：${err}——须台内、不压球、不入袋口区`);
      return;
    }
    moveCueTo(p);
    state.placedCue = { x, y };
    setStatus(`自由球已摆 (${x.toFixed(2)}, ${y.toFixed(2)})`, "再瞄准出杆；不满意可继续拖动母球");
    schedulePreview();
  }

  function finishPlacement() {
    const cue = cueBall();
    if (!cue || !state.placingFrom) return;
    const err = cueSpotError(cue.x, cue.y);
    if (err) {
      cue.x = state.placingFrom.x;
      cue.y = state.placingFrom.y;
      moveCueTo(cue);
      setStatus("位置不合法，已还原", `摆位失败：${err}——须台内、不压球、不入袋口区`);
      state.placingFrom = null;
      return;
    }
    state.placedCue = { x: cue.x, y: cue.y };
    state.placingFrom = null;
    setStatus(
      `自由球已摆 (${cue.x.toFixed(2)}, ${cue.y.toFixed(2)})`,
      "再瞄准出杆；不满意可继续拖动母球",
    );
    schedulePreview();
  }

  function selectTarget(ballId) {
    const assist = state.aimAssists.find((a) => a.ball === ballId);
    if (!assist) return;
    state.target = assist;
    drawAim();
  }

  /** 开局前球层为空（table.js 只在击球动画时画球）——轮到人类时主动铺球，否则没法瞄 */
  function ensureBallsVisible() {
    if (!state.balls.length || !P.scene.ballLayer || P.scene.balls.size > 0) return;
    P.updateScene(Object.fromEntries(state.balls.map((b) => [b.id, { x: b.x, y: b.y }])));
  }

  function snapToGhost() {
    const cue = cueBall();
    const t = state.target;
    if (!cue || !t) return;
    setAngle((Math.atan2(-(t.ghost.y - cue.y), t.ghost.x - cue.x) * 180) / Math.PI);
  }

  /** 自动瞄准：选切角最小的合法目标（oracle 同款）并对准 ghost；开球直取顶球 */
  function autoAim() {
    if (!state.active) return;
    const cue = cueBall();
    if (!cue) return;
    if (state.breakShot) {
      const apex = state.balls.find((b) => b.id === "1");
      if (apex) setAngle((Math.atan2(-(apex.y - cue.y), apex.x - cue.x) * 180) / Math.PI);
      return;
    }
    const t = bestAssist();
    if (!t) return;
    state.target = t;
    snapToGhost();
  }

  /* ---------- 击球点（spin）圆盘：侧栏大盘 + 全屏小盘，同步同一状态 ---------- */
  function setSpinFromDisk(disk, event) {
    const rect = disk.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2;
    const dx = (event.clientX - cx) / maxR;
    const dy = (event.clientY - cy) / maxR;
    const d = Math.hypot(dx, dy);
    if (d < 0.14) {
      state.spin = null;
    } else {
      const clamped = Math.min(1, d);
      const strength = clamped * SPIN_MAX;
      // 屏幕上=高杆（spin.y 正），下=低杆；左右=加塞（spin.z）
      state.spin = { x: 0, y: (-dy / d) * strength, z: (dx / d) * strength };
    }
    updateSpinDot();
    schedulePreview();
  }

  function spinDesc(s) {
    if (!s) return "中心";
    const parts = [];
    if (s.y > 0.03) parts.push(`高杆 +${s.y.toFixed(2)}`);
    else if (s.y < -0.03) parts.push(`低杆 ${s.y.toFixed(2)}`);
    if (s.z > 0.03) parts.push(`右塞 +${s.z.toFixed(2)}`);
    else if (s.z < -0.03) parts.push(`左塞 ${s.z.toFixed(2)}`);
    return parts.length ? parts.join(" · ") : "中心";
  }

  function updateSpinDot() {
    const s = state.spin;
    const pctX = s ? (s.z / SPIN_MAX) * 42 : 0;
    const pctY = s ? (-s.y / SPIN_MAX) * 42 : 0;
    for (const dot of [spinDot, spinDotBig]) {
      dot.style.left = `${50 + pctX}%`;
      dot.style.top = `${50 + pctY}%`;
    }
    spinRead.textContent = spinDesc(s);
  }

  /* ---------- 回合状态机 ---------- */
  function bestAssist() {
    return (
      state.aimAssists.reduce(
        (a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a),
        state.aimAssists[0],
      ) ?? null
    );
  }

  async function activate() {
    const { status, data } = await api(`/match/observe?name=${encodeURIComponent(state.name)}`);
    if (status !== 200 || !data || data.kind !== "match-observe") return;
    state.active = true;
    state.balls = data.balls ?? [];
    state.aimAssists = data.aimAssists ?? [];
    state.breakShot = data.breakShot;
    state.ballInHand = data.ballInHand === true;
    state.placedCue = null;
    state.target = bestAssist();
    ensureBallsVisible();
    if (state.breakShot) {
      const cue = cueBall();
      const apex = state.balls.find((b) => b.id === "1");
      if (cue && apex) {
        setAngle((Math.atan2(-(apex.y - cue.y), apex.x - cue.x) * 180) / Math.PI);
        setPower(0.85);
      }
      setStatus("▶ 你 · 开球", "轮到你开球：瞄准球堆，力度已调至 0.85；a=自动瞄准，Enter=出杆");
    } else {
      const cue = cueBall();
      if (cue && state.target) {
        setAngle(
          (Math.atan2(-(state.target.ghost.y - cue.y), state.target.ghost.x - cue.x) * 180) /
            Math.PI,
        );
      }
      const group =
        data.yourGroup === "stripes" ? "花色" : data.yourGroup === "solids" ? "全色" : "开放";
      setStatus(
        state.ballInHand ? "▶ 你 · 自由球" : `▶ 你 · ${group}组`,
        state.ballInHand
          ? "母球落袋：拖动母球（或点空处）摆到空位，再瞄准出杆"
          : "轮到你。点击球选目标，拖拽瞄准；a=自动瞄准，Enter=出杆；金线=纯物理预演",
      );
    }
    groups();
    drawAim();
    fireButton.disabled = false;
    snapButton.disabled = !state.target;
    autoButton.disabled = false;
    schedulePreview();
  }

  function deactivate(message) {
    state.active = false;
    fireButton.disabled = true;
    snapButton.disabled = true;
    autoButton.disabled = true;
    if (message) setStatus(message);
    drawAim();
  }

  async function poll() {
    if (!state.joined || document.hidden) return;
    try {
      const { data } = await api("/match/state");
      if (!data) return;
      if (data.over) {
        deactivate(`对局结束：${data.reason ?? ""}`);
        return;
      }
      const waiting = data.waitingFor;
      if (waiting === state.seat && !state.active && !P.animating()) {
        await activate();
      } else if (waiting !== state.seat && state.active) {
        const opp = waiting ? `等 ${data.seats?.[waiting] ?? waiting} 出杆…` : "等对局推进…";
        deactivate(opp);
      }
    } catch {
      /* 网络抖动：下轮再试 */
    }
  }

  /* ---------- 出杆 ---------- */
  async function fire() {
    if (!state.active || !state.joined) return;
    const cue = cueBall();
    if (!cue) return;
    const t = state.target ?? bestAssist();
    if (!t) {
      setStatus("没有可选目标");
      return;
    }
    const rad = (state.angle * Math.PI) / 180;
    const aim = { x: cue.x + Math.cos(rad) * 0.5, y: cue.y - Math.sin(rad) * 0.5 };
    fireButton.disabled = true;
    state.active = false;
    const { status, data } = await api("/match/shot", {
      name: state.name,
      aimX: aim.x,
      aimY: aim.y,
      power: state.power,
      spin: state.spin ?? undefined,
      targetBall: t.ball,
      targetPocket: t.pocket,
      prediction: `瞄 ${state.angle.toFixed(1)}° 力 ${state.power.toFixed(2)}${state.spin ? " 带旋转" : ""}`,
      // 默认纯物理（clean）；勾选「手感注入」后才带噪声
      clean: noiseInput.checked ? undefined : true,
      // 自由球摆位（仅 ballInHand 时已确认摆放才携带）
      cue: state.placedCue ?? undefined,
    });
    if (status !== 202) {
      state.active = true;
      fireButton.disabled = false;
      setStatus(data?.error ?? `出杆被拒绝（${status}）`);
      return;
    }
    setStatus(
      noiseInput.checked ? "已出杆 · 金=预演 橙=实际" : "已出杆 · 纯物理",
      noiseInput.checked
        ? "已出杆 · 金线=预演，橙线=实际（手感噪声后的真实轨迹）"
        : "已出杆 · 纯物理：实际轨迹应与预演金线重合",
    );
    snapButton.disabled = true;
    state.placedCue = null;
  }

  /* ---------- 入座 ---------- */
  async function join() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      setStatus("先填名字", "先填一个身份名——跨局手感记忆绑定它");
      return;
    }
    state.name = name;
    localStorage.setItem(NAME_KEY, name);
    // 桌页（/table/<id>）入座锁定本桌；大厅入口不带桌号才自动分配
    const path = state.preferredTable
      ? `/match/join?table=${encodeURIComponent(state.preferredTable)}`
      : "/match/join";
    const { status, data } = await api(path, { name });
    if (status !== 200 || !data?.ok) {
      setStatus(data?.error ?? `入座失败（${status}）`);
      return;
    }
    state.seat = data.seat;
    state.table = state.preferredTable ?? data.table ?? null;
    state.joined = true;
    joinButton.textContent = "离开";
    nameInput.disabled = true;
    const clock = data.shotClockMs > 0 ? `限时 ${Math.round(data.shotClockMs / 1000)}s` : "不限时";
    setStatus(
      `${state.table ? `${state.table} · ` : ""}${data.seat} 席 · ${clock}`,
      `已入座 ${data.seat} 位，出杆${clock}，等待轮到你`,
    );
  }

  /** 离席：对局进行中 = 放弃本局（判负终局）；未开局 = 释放座位 */
  async function leave() {
    const { status, data } = await api("/match/leave", { name: state.name });
    state.joined = false;
    state.seat = null;
    state.active = false;
    state.ballInHand = false;
    state.placedCue = null;
    joinButton.textContent = "🪑 入座";
    nameInput.disabled = false;
    fireButton.disabled = true;
    snapButton.disabled = true;
    autoButton.disabled = true;
    drawAim();
    drawPreview(null);
    setStatus(
      status === 200
        ? data?.resigned
          ? "已离席 · 本局判负"
          : "已离席"
        : (data?.error ?? `离席失败（${status}）`),
      status === 200 && data?.resigned ? "放弃本局判负，桌面立刻可续新局" : undefined,
    );
  }

  function onNewSession() {
    state.active = false;
    state.balls = [];
    state.aimAssists = [];
    state.target = null;
    state.ballInHand = false;
    state.placedCue = null;
    fireButton.disabled = true;
    snapButton.disabled = true;
    drawAim();
    drawPreview(null);
    if (state.joined) setStatus("新局 · 等回合", "新局开始，等待轮到你");
  }

  /* ---------- 键盘微调（a=自动瞄准最佳球，Enter=出杆） ---------- */
  document.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (!state.active) return;
    const fine = event.shiftKey ? 0.1 : 0.5;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setAngle(state.angle + fine);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setAngle(state.angle - fine);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPower(state.power + 0.02);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setPower(state.power - 0.02);
    } else if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      autoAim();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void fire();
    }
  });

  /* ---------- 角度读数拖动微调（右拖 + 左拖 −，Shift 精调） ---------- */
  let angleDrag = null;
  angleEl.addEventListener("pointerdown", (event) => {
    if (!state.active) return;
    event.preventDefault();
    angleDrag = { x: event.clientX };
    angleEl.setPointerCapture(event.pointerId);
  });
  angleEl.addEventListener("pointermove", (event) => {
    if (!angleDrag) return;
    const dx = event.clientX - angleDrag.x;
    angleDrag.x = event.clientX;
    setAngle(state.angle + dx * (event.shiftKey ? 0.02 : 0.1));
  });
  const endAngleDrag = () => {
    angleDrag = null;
  };
  angleEl.addEventListener("pointerup", endAngleDrag);
  angleEl.addEventListener("pointercancel", endAngleDrag);

  /* ---------- 初始化 ---------- */
  function init() {
    if (document.body.classList.contains("offline")) return;
    bar.hidden = false;
    nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
    noiseInput.checked = localStorage.getItem(NOISE_KEY) === "1";
    noiseInput.addEventListener("change", () => {
      localStorage.setItem(NOISE_KEY, noiseInput.checked ? "1" : "0");
    });
    tableFrame.addEventListener("pointerdown", onPointerDown);
    tableFrame.addEventListener("pointermove", onPointerMove);
    tableFrame.addEventListener("pointerup", onPointerUp);
    tableFrame.addEventListener("pointercancel", () => {
      state.drag = null;
    });
    joinButton.addEventListener("click", () => {
      if (state.joined) void leave();
      else void join();
    });
    fireButton.addEventListener("click", () => void fire());
    snapButton.addEventListener("click", snapToGhost);
    powerInput.addEventListener("input", () => setPower(Number(powerInput.value)));
    spinDisk.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setSpinFromDisk(spinDisk, event);
    });
    spinDiskBig.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setSpinFromDisk(spinDiskBig, event);
    });
    P.onSession(onNewSession);
    // 动画播完即尝试激活（不等下一轮轮询）；动画期间激活被 gate 住
    P.onAnim((busy) => {
      if (!busy && state.joined) void poll();
    });
    setInterval(() => void poll(), POLL_MS);
    // 记住名字即自动重连入座（幂等：已在座则返回原席位）
    if (nameInput.value) void join();
  }

  init();
})();
