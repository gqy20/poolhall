/**
 * 校准挑战 trial 协议（docs/hand-model.md §4 / docs/benchmark.md §1）
 *
 * 布局约束：目标球距选定袋 0.5–1.0m、母球距目标球 0.3–0.7m、切角 ≤ 25°、无遮挡。
 * 由计数器 RNG 生成（单 trial 可独立重放）；切角直接由生成几何控制。
 * 观察含 aimAssist（公开几何参考：ghost 位/建议角/切角）——"知"层可计算是 README
 * 的设计本意，benchmark 测的是手感校准（"行"），不是三角心算。
 */
import {
  type Ball,
  buildTable,
  DEFAULT_BALL,
  ghostPos,
  makeBall,
  norm,
  simulate,
  solvePot,
  strike,
  sub,
  type Table,
  type Vec2,
  vec2,
} from "@poolhall/engine";
import { applyHand, biasFrom, type HandModel, noiseAtShot, traitFrom } from "./hand.ts";
import { nextInt, rangeDot, streamOf } from "./rng.ts";
import { type AgentObserve, agentObserve, type ResearchShot } from "./views.ts";

export interface TrialLayout {
  cue: Ball;
  obj: Ball;
  pocketId: string;
  pocketCenter: Vec2;
  /** 目标球到袋距离（m） */
  objDist: number;
  /** 切角（度） */
  cutAngle: number;
}

/** 球位 ω 旋转向量（绕 z 轴） */
function rot(v: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

/** 生成第 index 个 trial 的清朗布局（约束见文件头；64 次重抽兜底） */
function genLayout(table: Table, g: ReturnType<typeof streamOf>): TrialLayout {
  const R = DEFAULT_BALL.R;
  for (let attempt = 0; attempt < 64; attempt++) {
    const pocket = table.pockets[nextInt(g, table.pockets.length)]!;
    // 目标球：距袋 0.5–1.0m，方位在朝台面中心 ±55° 扇形内
    const toCenter = norm(sub(vec2(table.width / 2, table.height / 2), pocket.center));
    const dirToObj = rot(toCenter, rangeDot(g, -55, 55));
    const objDist = rangeDot(g, 0.5, 1.0);
    const objPos = {
      x: pocket.center.x + dirToObj.x * objDist,
      y: pocket.center.y + dirToObj.y * objDist,
    };
    if (!inBounds(objPos, table, R * 3)) continue;
    // 母球：ghost 位后方锥内；中心距（cue↔obj）硬约束 0.3–0.7m，超界重抽
    const back = norm(sub(objPos, pocket.center)); // 袋 → 球
    const ghost = vec2(objPos.x + back.x * 2 * R, objPos.y + back.y * 2 * R);
    const cutDeg = rangeDot(g, -25, 25);
    const cueDir = rot(back, rangeDot(g, -5, 5));
    const cueDist = rangeDot(g, 0.25, 0.55);
    const cuePos = {
      x: ghost.x + cueDir.x * cueDist,
      y: ghost.y + cueDir.y * cueDist,
    };
    const cd = Math.hypot(cuePos.x - objPos.x, cuePos.y - objPos.y);
    if (cd < 0.3 || cd > 0.7) continue;
    if (!inBounds(cuePos, table, R * 3)) continue;
    return {
      cue: makeBall("cue", cuePos),
      obj: makeBall("1", objPos),
      pocketId: pocket.id,
      pocketCenter: pocket.center,
      objDist,
      cutAngle: Math.abs(cutDeg),
    };
  }
  throw new Error("trial 布局生成失败（64 次重抽后仍无解）");
}

const inBounds = (p: Vec2, t: Table, m: number): boolean =>
  p.x >= m && p.x <= t.width - m && p.y >= m && p.y <= t.height - m;

export interface CalibOpts {
  seed: number;
  agent: string;
  trialCount?: number;
  /** 覆盖身份 bias（实验对照组 bias=0 用） */
  biasOverride?: number | null;
}

/** 校准挑战会话：一局 N 个 trial，每 trial 一杆（docs/hand-model.md §4） */
export class CalibSession {
  readonly seed: number;
  readonly agent: string;
  readonly trialCount: number;
  readonly hand: HandModel;

  private idx = 0;
  private score = 0;
  private layout: TrialLayout;
  private records: ResearchShot[] = [];
  private readonly table = buildTable();

  constructor(opts: CalibOpts) {
    this.seed = opts.seed;
    this.agent = opts.agent;
    this.trialCount = opts.trialCount ?? 20;
    this.hand = {
      ...traitFrom(opts.seed, opts.agent, 0),
      biasBase: opts.biasOverride ?? biasFrom(opts.seed, opts.agent),
    };
    this.layout = genLayout(this.table, streamOf(this.seed, this.agent, "layout", 0));
  }

  get trial(): number {
    return this.idx;
  }

  get finished(): boolean {
    return this.idx >= this.trialCount;
  }

  get currentLayout(): TrialLayout {
    return this.layout;
  }

  /** Agent 视图观察（白名单字段 + 断言无泄漏） */
  observe(): AgentObserve {
    const target = this.table.pockets.find((pk) => pk.id === this.layout.pocketId)!;
    const R = DEFAULT_BALL.R;
    const suggested = solvePot(this.layout.cue.pos, this.layout.obj.pos, target.center, R);
    const obs = agentObserve(
      this.idx,
      this.trialCount,
      this.score,
      this.layout.pocketId,
      [this.layout.cue, this.layout.obj].map((b) => ({
        id: b.id,
        x: b.pos.x,
        y: b.pos.y,
      })),
      this.table.pockets.map((pk) => ({ id: pk.id, x: pk.center.x, y: pk.center.y })),
      suggested === null
        ? undefined
        : {
            ghost: ghostPos(this.layout.obj.pos, target.center, R),
            suggestedAngle: suggested,
            cutAngleDeg: this.layout.cutAngle,
          },
    );
    return obs;
  }

  /** 出杆：注入手感 → 模拟 → 记录三元组 */
  shoot(intent: { angle: number; power: number }): ResearchShot {
    if (this.finished) throw new Error("本局已结束");
    const idx = this.idx;
    const noise = noiseAtShot(this.hand, idx, this.seed, this.agent);
    const actual = applyHand(intent, noise);
    const optimal = solvePot(
      this.layout.cue.pos,
      this.layout.obj.pos,
      this.layout.pocketCenter,
      DEFAULT_BALL.R,
    );

    const cue = { ...this.layout.cue, pos: { ...this.layout.cue.pos } };
    const obj = { ...this.layout.obj, pos: { ...this.layout.obj.pos } };
    strike(cue, actual.angle, actual.power);
    const r = simulate([cue, obj], this.table);
    const objFinal = r.balls.find((b) => b.id === "1")!;
    const pot = objFinal.pocketed && objFinal.pocket === this.layout.pocketId;
    if (pot) this.score += 1;

    const finals: ResearchShot["finalPos"] = {};
    for (const b of r.balls) finals[b.id] = { x: b.pos.x, y: b.pos.y };

    const rec: ResearchShot = {
      trial: idx,
      intent: { ...intent },
      actual,
      optimal,
      noise,
      pot,
      pottedPocket: objFinal.pocketed ? (objFinal.pocket ?? null) : null,
      finalPos: finals,
      samples: r.samples,
      events: r.events,
    };
    this.records.push(rec);

    this.idx += 1;
    if (!this.finished) {
      this.layout = genLayout(this.table, streamOf(this.seed, this.agent, "layout", this.idx));
    }
    return rec;
  }

  result(): { score: number; trialCount: number; records: ResearchShot[] } {
    return { score: this.score, trialCount: this.trialCount, records: this.records };
  }
}

// ghostOf：与 engine 的 ghostPos 同式（此处直接引出，避免重复实现漂移）
const _ghostOf = (obj: Vec2, pocket: Vec2): Vec2 => ghostPos(obj, pocket, DEFAULT_BALL.R);
void sub;
