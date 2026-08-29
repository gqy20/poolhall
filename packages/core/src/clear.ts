/**
 * 清台挑战会话（README 游戏模式：9 球连续击打清台，M6 起点）
 *
 * 规则（v1 简化版，非标准 9 琗）：
 * - 9 颗彩球菱形摆位（seed 决定确定性布局）+ 母球开球位
 * - 任意球进任意袋均有效；计分赛制：固定杆数预算内 maximizing 进球数
 *   （未进只是浪费一杆——单 agent 下"进球连杆"无 turn 语义，开球 miss 不应一杆终局）
 * - 母球进袋（scratch）= 本局结束 + 犯规记一次（强威慑，符合真实规则直觉）
 * - 终局 = 清台 | scratch | 预算耗尽
 * - 手感噪声经 applyHand 注入（与校准挑战同一 hand model 语义）
 *
 * 观察含 aimAssists：每颗剩余球【最容易球-袋组合】的 ghost 瞄点（"知"层可计算，
 * benchmark 测"行"+ 规划，与校准挑战的设计哲学一致）。
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
  vec2,
} from "@poolhall/engine";
import { applyHand, biasFrom, type HandModel, noiseAtShot, traitFrom } from "./hand.ts";
import { nextDouble, streamOf } from "./rng.ts";

export interface ClearObserve {
  kind: "clear-observe";
  shot: number;
  /** 已进袋球数 */
  potted: number;
  total: number;
  remaining: number;
  balls: Array<{ id: string; x: number; y: number }>;
  pockets: Array<{ id: string; x: number; y: number }>;
  /** 每颗剩余球最容易球-袋组合的参考瞄点（公开几何） */
  aimAssists: Array<{
    ball: string;
    pocket: string;
    ghost: { x: number; y: number };
    cutAngleDeg: number;
  }>;
}

export interface ClearShotResult {
  shot: number;
  /** 本杆进袋的球（可能 0 颗或多颗——连续击打下可能一杆双下） */
  pottedBalls: string[];
  pottedPockets: Array<{ ball: string; pocket: string }>;
  /** 母球进袋 */
  scratch: boolean;
  /** 本杆后母球位置（scratch 时为 null） */
  cueFinal: { x: number; y: number } | null;
  /** 终态全部球位 */
  finalPos: Record<string, { x: number; y: number }>;
  samples: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>;
  events: Array<{ t: number; kind: string; a: string; b?: string; pocket?: string }>;
  /** 本杆后是否继续（未 scratch、未清台、预算未尽） */
  continueTurn: boolean;
  /** 本杆意图角 vs 最优角（研究用；aim 的球-袋组合由 agent 自报或 aimAssist 首选推断） */
  intentAngle: number;
}

export interface ClearOpts {
  seed: number;
  agent: string;
  /** 杆数预算 */
  maxShots?: number;
  biasOverride?: number | null;
}

/** 9 球菱形摆位（1-2-3-2-1，1 在顶点朝母球；seed 微扰防完美对称卡死物理） */
function rack(seed: number, agent: string, table: Table): Ball[] {
  const g = streamOf(seed, agent, "rack", 0);
  const R = DEFAULT_BALL.R;
  const balls: Ball[] = [makeBall("cue", vec2(table.width / 2, table.height * 0.75))];
  const apex = vec2(table.width / 2, table.height * 0.3);
  const rowDy = 2 * R * Math.cos(Math.PI / 6); // 行距（沿 +y 朝母球）
  const jitter = () => (nextDouble(g) - 0.5) * 0.04 * R; // ≤±0.02R：不致相邻球重叠（最小 1.96R）
  const rows = [1, 2, 3, 2, 1];
  let id = 1;
  for (let row = 0; row < rows.length; row++) {
    const n = rows[row]!;
    for (let i = 0; i < n; i++) {
      const x = apex.x + (i - (n - 1) / 2) * 2 * R + jitter();
      const y = apex.y + row * rowDy + jitter();
      balls.push(makeBall(String(id), vec2(x, y)));
      id++;
    }
  }
  return balls;
}

/** 为每颗剩余球找最容易的球-袋组合（ghost 瞄点 + 切角最小） */
function bestAssists(balls: Ball[], table: Table): ClearObserve["aimAssists"] {
  const R = DEFAULT_BALL.R;
  const out: ClearObserve["aimAssists"] = [];
  const cue = balls.find((b) => b.id === "cue");
  if (!cue) return out;
  for (const b of balls) {
    if (b.id === "cue" || b.pocketed) continue;
    let best: ClearObserve["aimAssists"][number] | null = null;
    for (const pk of table.pockets) {
      const aim = solvePot(cue.pos, b.pos, pk.center, R);
      if (aim === null) continue;
      // 切角 = 母球方向与球-袋方向的夹角
      const toPocket = norm(sub(pk.center, b.pos));
      const toCue = norm(sub(cue.pos, b.pos));
      const cosCut = toPocket.x * toCue.x + toPocket.y * toCue.y;
      const cut = (Math.acos(Math.max(-1, Math.min(1, cosCut))) * 180) / Math.PI;
      if (cut > 80) continue; // 近背对，不可行
      if (!best || cut < best.cutAngleDeg) {
        best = {
          ball: b.id,
          pocket: pk.id,
          ghost: ghostPos(b.pos, pk.center, R),
          cutAngleDeg: cut,
        };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

export class ClearSession {
  readonly seed: number;
  readonly agent: string;
  readonly maxShots: number;
  readonly hand: HandModel;
  readonly total = 9;

  private balls: Ball[];
  private shotIdx = 0;
  private pottedCount = 0;
  private scratchCount = 0;
  private readonly table = buildTable();

  constructor(opts: ClearOpts) {
    this.seed = opts.seed;
    this.agent = opts.agent;
    this.maxShots = opts.maxShots ?? 30;
    this.hand = {
      ...traitFrom(opts.seed, opts.agent, 0),
      biasBase: opts.biasOverride ?? biasFrom(opts.seed, opts.agent),
    };
    this.balls = rack(opts.seed, opts.agent, this.table);
  }

  get shot(): number {
    return this.shotIdx;
  }

  get finished(): boolean {
    return this.pottedCount >= this.total || this.shotIdx >= this.maxShots || this.ended_;
  }

  private ended_ = false;

  get potted(): number {
    return this.pottedCount;
  }

  get scratches(): number {
    return this.scratchCount;
  }

  /** Agent 观察（白名单：球位/袋位/进度/每球参考瞄点——无 hand 字段） */
  observe(): ClearObserve {
    return {
      kind: "clear-observe",
      shot: this.shotIdx,
      potted: this.pottedCount,
      total: this.total,
      remaining: this.total - this.pottedCount,
      balls: this.balls
        .filter((b) => !b.pocketed)
        .map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y })),
      pockets: this.table.pockets.map((pk) => ({ id: pk.id, x: pk.center.x, y: pk.center.y })),
      aimAssists: bestAssists(this.balls, this.table),
    };
  }

  /** 出杆：注入手感 → 全桌模拟 → 判定进球/scratch/回合结束 */
  shoot(intent: {
    angle: number;
    power: number;
    spin?: { x: number; y: number; z: number };
  }): ClearShotResult {
    if (this.finished) throw new Error("本局已结束");
    const idx = this.shotIdx;
    const noise = noiseAtShot(this.hand, idx, this.seed, this.agent);
    const actual = applyHand(intent, noise);

    const balls = this.balls.map((b) => ({
      ...b,
      pos: { ...b.pos },
      vel: { ...b.vel },
      w: { ...b.w },
    }));
    const alreadyIn = new Set(this.balls.filter((b) => b.pocketed).map((b) => b.id));
    const cue = balls.find((b) => b.id === "cue")!;
    strike(cue, actual.angle, actual.power, intent.spin);
    const r = simulate(balls, this.table);

    const pottedPockets: Array<{ ball: string; pocket: string }> = [];
    let scratch = false;
    for (const b of r.balls) {
      if (b.id === "cue") {
        if (b.pocketed) scratch = true;
        continue;
      }
      // 只计本杆新进袋（pocketed 标志跨杆持久，旧袋球不得重复计数）
      if (b.pocketed && b.pocket && !alreadyIn.has(b.id)) {
        pottedPockets.push({ ball: b.id, pocket: b.pocket });
      }
    }
    this.pottedCount += pottedPockets.length;
    if (scratch) this.scratchCount += 1;

    // 同步回 this.balls（终态）
    this.balls = r.balls;
    this.shotIdx += 1;

    // v1 计分赛制：未进不终局（浪费一杆）；终局 = 清台 | scratch | 预算耗尽
    const continueTurn = !scratch && this.pottedCount < this.total && this.shotIdx < this.maxShots;
    if (!continueTurn) this.ended_ = true;

    const cueFinal = scratch
      ? null
      : {
          x: r.balls.find((b) => b.id === "cue")!.pos.x,
          y: r.balls.find((b) => b.id === "cue")!.pos.y,
        };
    const finalPos: Record<string, { x: number; y: number }> = {};
    for (const b of r.balls) finalPos[b.id] = { x: b.pos.x, y: b.pos.y };

    return {
      shot: idx,
      pottedBalls: pottedPockets.map((p) => p.ball),
      pottedPockets,
      scratch,
      cueFinal,
      finalPos,
      samples: r.samples,
      events: r.events,
      continueTurn,
      intentAngle: intent.angle,
    };
  }

  result(): { potted: number; total: number; shots: number; scratches: number; cleared: boolean } {
    return {
      potted: this.pottedCount,
      total: this.total,
      shots: this.shotIdx,
      scratches: this.scratchCount,
      cleared: this.pottedCount >= this.total,
    };
  }
}
