/**
 * 模拟主循环（docs/physics.md §5 A' 方案）
 *
 * 固定 1ms 步长；步内扫掠最早碰撞 → 积分到 t* → 解算 → 循环。
 * 时刻用"步数 × dt"计算（不累加），采样按整数步对齐——确定性由构造保证。
 */

import { pocketBall, resolveBallBall, resolveCushion } from "./collide.ts";
import { type BallParams, DEFAULT_BALL, SIM } from "./consts.ts";
import { integrateAll } from "./physics.ts";
import { type Collision, earliestCollision } from "./sweep.ts";
import { buildTable, type Table } from "./table.ts";
import type { Ball, MotionEvent, Sample, SimResult, StopReason } from "./types.ts";

export interface SimOpts {
  /** watchdog（模拟秒），默认 120 */
  watchdog?: number;
  /** 采样间隔（模拟秒），默认 0.01 */
  sampleEvery?: number;
}

const cloneBalls = (balls: Ball[]): Ball[] =>
  balls.map((b) => ({
    id: b.id,
    pos: { ...b.pos },
    vel: { ...b.vel },
    w: { ...b.w },
    pocketed: b.pocketed,
    pocket: b.pocket,
  }));

const snapshot = (balls: Ball[], t: number): Sample => {
  const pos: Sample["pos"] = {};
  for (const b of balls) pos[b.id] = { ...b.pos };
  return { t, pos };
};

const allAtRest = (balls: Ball[]): boolean =>
  balls.every(
    (b) =>
      b.pocketed || (b.vel.x === 0 && b.vel.y === 0 && b.w.x === 0 && b.w.y === 0 && b.w.z === 0),
  );

function applyCollision(
  c: Collision,
  events: MotionEvent[],
  table: Table,
  p: BallParams,
  tAbs: number,
): void {
  switch (c.kind) {
    case "ball-ball":
      resolveBallBall(c.a, c.b, p);
      events.push({ t: tAbs, kind: "ball-ball", a: c.a.id, b: c.b.id });
      break;
    case "ball-cushion":
      resolveCushion(c.ball, c.dir, p);
      events.push({ t: tAbs, kind: "ball-cushion", a: c.ball.id, cushion: c.dir });
      break;
    case "pocket": {
      const pk = table.pockets.find((x) => x.id === c.pocket);
      if (pk && !c.ball.pocketed) {
        pocketBall(c.ball, pk.id, pk.center);
        events.push({ t: tAbs, kind: "pocket", a: c.ball.id, pocket: pk.id });
      }
      break;
    }
  }
}

/** 模拟一杆，直到全场静止或 watchdog（确定性：同输入 → 同轨迹） */
export function simulate(
  balls0: Ball[],
  table: Table = buildTable(),
  p: BallParams = DEFAULT_BALL,
  opts: SimOpts = {},
): SimResult {
  const balls = cloneBalls(balls0);
  const watchdog = opts.watchdog ?? SIM.watchdog;
  const maxSteps = Math.ceil(watchdog / SIM.dt);
  const sampleSteps = Math.max(1, Math.round((opts.sampleEvery ?? SIM.sampleEvery) / SIM.dt));
  const events: MotionEvent[] = [];
  const samples: Sample[] = [snapshot(balls, 0)];

  let step = 0;
  let stopReason: StopReason = "stopped";

  while (step < maxSteps) {
    if (allAtRest(balls)) break;
    // 步内事件循环
    let tRemain = SIM.dt;
    let guard = 0;
    while (tRemain > 1e-12 && guard < SIM.maxEventsPerStep) {
      const col = earliestCollision(balls, table, p, tRemain);
      if (!col) break;
      const tAbs = step * SIM.dt + (SIM.dt - tRemain) + col.t;
      integrateAll(balls, p, col.t);
      applyCollision(col, events, table, p, tAbs);
      tRemain -= col.t;
      guard++;
    }
    integrateAll(balls, p, tRemain);
    step++;
    if (step % sampleSteps === 0) samples.push(snapshot(balls, step * SIM.dt));
  }

  if (step >= maxSteps && !allAtRest(balls)) stopReason = "watchdog";

  return { events, samples, balls, simTime: step * SIM.dt, stopReason };
}

/**
 * 轨迹序列化（哈希原料，docs/physics.md §6）：
 * samples + events 定点 6 位小数，键排序。core/cli 侧对它做 SHA-256。
 */
export function serializeTrajectory(r: SimResult): string {
  const lines: string[] = [];
  for (const s of r.samples) {
    const balls = Object.keys(s.pos)
      .sort()
      .map((id) => `${id}:${s.pos[id]!.x.toFixed(6)},${s.pos[id]!.y.toFixed(6)}`)
      .join(" ");
    lines.push(`s ${s.t.toFixed(6)} ${balls}`);
  }
  for (const e of r.events) {
    const extra = e.b ?? e.pocket ?? e.cushion ?? "";
    lines.push(`e ${e.t.toFixed(6)} ${e.kind} ${e.a} ${extra}`);
  }
  return lines.join("\n");
}
