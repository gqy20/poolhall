/**
 * 中式八球对局会话（M6：Agent vs Agent 的规则地基）
 *
 * v1 简化规则（相对完整中式八球规则的裁剪，见 docs/match.md）：
 * - 15 球标准三角摆位（1 顶点，8 居中心第三行，底两角一全色一花色；seed 微扰）
 * - 开球后 open table：首个合法进球确定进球方花色组（全色 1-7 / 花色 9-15）
 * - 轮流击打：合法进自己组的球 → 继续打；未进/犯规 → 换人
 * - 清完本组后打 8：合法进 8 = 胜
 * - 判负：提前进 8；打 8 时 scratch；打 8 未进且犯规（v1 简化：只做前两条）
 * - 犯规 v1 只判两类：scratch（母球进袋，换人+母球重置开球点）、首触错组/错打8
 *   （首触从 events 首个 ball-ball 事件读取）
 * - 自由球 v1 简化：不做任意摆位，scratch 后母球重置开球点（被挡时向右顺延）
 *
 * 双选手各自 hand model（bias 独立）——"读对手 bias"心理层的地基。
 */
import {
  type Ball,
  buildTable,
  DEFAULT_BALL,
  makeBall,
  norm,
  simulate,
  strike,
  sub,
  type Table,
  vec2,
} from "@poolhall/engine";
import { applyHand, biasFrom, type HandModel, noiseAtShot, traitFrom } from "./hand.ts";
import { nextDouble, streamOf } from "./rng.ts";

export type Group = "solids" | "stripes" | "open";
export type PlayerId = "A" | "B";

export interface MatchObserve {
  kind: "match-observe";
  shot: number;
  /** 当前该谁打 */
  turn: PlayerId;
  /** 你是哪组（观察永远以当前选手视角给出）*/
  you: PlayerId;
  yourGroup: Group;
  oppGroup: Group;
  /** 各组已进袋球号 */
  pottedSolids: string[];
  pottedStripes: string[];
  balls: Array<{ id: string; x: number; y: number }>;
  pockets: Array<{ id: string; x: number; y: number }>;
  /** 当前选手视角的每球参考瞄点（与清台同款，公开几何） */
  aimAssists: Array<{
    ball: string;
    pocket: string;
    ghost: { x: number; y: number };
    cutAngleDeg: number;
  }>;
}

export interface MatchShotResult {
  shot: number;
  byPlayer: PlayerId;
  /** 本杆进袋（含对方球/8——进对方球属犯规换人，v1 不判负） */
  pottedBalls: string[];
  pottedPockets: Array<{ ball: string; pocket: string }>;
  scratch: boolean;
  firstContact: string | null;
  /** 犯规描述（null=合法） */
  foul: string | null;
  /** 本杆后轮到谁 */
  nextTurn: PlayerId;
  /** 本杆后是否继续（未 scratch、未清台、预算未尽） */
  continueTurn: boolean;
  /** 对局是否结束 + 结局 */
  over: boolean;
  winner: PlayerId | null;
  reason: string | null;
  finalPos: Record<string, { x: number; y: number }>;
  samples: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>;
  events: Array<{ t: number; kind: string; a: string; b?: string; pocket?: string }>;
}

export interface MatchOpts {
  seed: number;
  nameA: string;
  nameB: string;
  maxShots?: number;
}

const SOLIDS = new Set(["1", "2", "3", "4", "5", "6", "7"]);
const STRIPES = new Set(["9", "10", "11", "12", "13", "14", "15"]);

const groupOf = (id: string): Group | "eight" | "cue" =>
  id === "8" ? "eight" : SOLIDS.has(id) ? "solids" : STRIPES.has(id) ? "stripes" : "cue";

/** 15 球标准三角（1 顶点、8 第三行中位、底行两角一全色一花色；seed 洗牌+微扰） */
function rack(seed: number, table: Table): Ball[] {
  const g = streamOf(seed, "match", "rack", 0);
  const R = DEFAULT_BALL.R;
  const balls: Ball[] = [makeBall("cue", vec2(table.width / 2, table.height * 0.75))];
  const apex = vec2(table.width / 2, table.height * 0.28);
  const rowDy = 2 * R * Math.cos(Math.PI / 6);
  const jitter = () => (nextDouble(g) - 0.5) * 0.03 * R;
  const rows = [1, 2, 3, 4, 5];

  // 号位分配：slot0=1（顶点）、slot4=8（第三行中位）、底行首尾一全色一花色，其余洗牌
  const pool = ["2", "3", "4", "5", "6", "7", "9", "10", "11", "12", "13", "14", "15"];
  const cornerSolid = pool.find((x) => SOLIDS.has(x))!;
  const cornerStripe = [...pool].reverse().find((x) => STRIPES.has(x))!;
  const rest = pool.filter((x) => x !== cornerSolid && x !== cornerStripe);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(nextDouble(g) * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const slotCount = rows.reduce((a, b) => a + b, 0); // 15
  const filled: Array<string | null> = new Array(slotCount).fill(null);
  filled[0] = "1";
  filled[4] = "8";
  const lastRowStart = slotCount - rows[4]!;
  let k = 0;
  for (let idx = 0; idx < slotCount; idx++) {
    if (filled[idx] !== null) continue;
    if (idx === lastRowStart) filled[idx] = cornerSolid;
    else if (idx === slotCount - 1) filled[idx] = cornerStripe;
    else filled[idx] = rest[k++]!;
  }

  let slot = 0;
  for (let row = 0; row < rows.length; row++) {
    const n = rows[row]!;
    for (let i = 0; i < n; i++) {
      const x = apex.x + (i - (n - 1) / 2) * 2 * R + jitter();
      const y = apex.y + row * rowDy + jitter();
      balls.push(makeBall(filled[slot++]!, vec2(x, y)));
    }
  }
  return balls;
}

export class MatchSession {
  readonly seed: number;
  readonly maxShots: number;
  readonly handA: HandModel;
  readonly handB: HandModel;

  private balls: Ball[];
  private shotIdx = 0;
  private turn: PlayerId = "A";
  private groupA: Group = "open";
  private groupB: Group = "open";
  private pottedSolids: string[] = [];
  private pottedStripes: string[] = [];
  private over_ = false;
  private winner: PlayerId | null = null;
  private reason: string | null = null;
  private readonly table = buildTable();

  constructor(opts: MatchOpts) {
    this.seed = opts.seed;
    this.maxShots = opts.maxShots ?? 60;
    this.nameA_ = opts.nameA;
    this.nameB_ = opts.nameB;
    this.handA = {
      ...traitFrom(opts.seed, opts.nameA, 1),
      biasBase: biasFrom(opts.seed, opts.nameA),
    };
    this.handB = {
      ...traitFrom(opts.seed, opts.nameB, 1),
      biasBase: biasFrom(opts.seed, opts.nameB),
    };
    this.balls = rack(opts.seed, this.table);
  }

  get finished(): boolean {
    return this.over_ || this.shotIdx >= this.maxShots;
  }

  get currentTurn(): PlayerId {
    return this.turn;
  }

  get groups(): { A: Group; B: Group } {
    return { A: this.groupA, B: this.groupB };
  }

  get result(): { winner: PlayerId | null; reason: string | null; shots: number } {
    return { winner: this.winner, reason: this.reason, shots: this.shotIdx };
  }

  private handOf(p: PlayerId): HandModel {
    return p === "A" ? this.handA : this.handB;
  }

  private readonly nameA_: string;
  private readonly nameB_: string;

  private nameOf(p: PlayerId): string {
    return p === "A" ? this.nameA_ : this.nameB_;
  }

  /** 当前选手视角观察（泄漏红线：无 bias/对手 hand） */
  observe(): MatchObserve {
    return {
      kind: "match-observe",
      shot: this.shotIdx,
      turn: this.turn,
      you: this.turn,
      yourGroup: this.turn === "A" ? this.groupA : this.groupB,
      oppGroup: this.turn === "A" ? this.groupB : this.groupA,
      pottedSolids: [...this.pottedSolids],
      pottedStripes: [...this.pottedStripes],
      balls: this.balls
        .filter((b) => !b.pocketed)
        .map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y })),
      pockets: this.table.pockets.map((pk) => ({ id: pk.id, x: pk.center.x, y: pk.center.y })),
      aimAssists: this.assists(),
    };
  }

  private assists(): MatchObserve["aimAssists"] {
    const R = DEFAULT_BALL.R;
    const cue = this.balls.find((b) => b.id === "cue");
    const out: MatchObserve["aimAssists"] = [];
    if (!cue) return out;
    for (const b of this.balls) {
      if (b.id === "cue" || b.pocketed) continue;
      let best: MatchObserve["aimAssists"][number] | null = null;
      for (const pk of this.table.pockets) {
        const toPocket = norm(sub(pk.center, b.pos));
        const toCue = norm(sub(cue.pos, b.pos));
        const cosCut = toPocket.x * toCue.x + toPocket.y * toCue.y;
        const cutDeg = (Math.acos(Math.max(-1, Math.min(1, cosCut))) * 180) / Math.PI;
        if (cutDeg > 80) continue;
        if (!best || cutDeg < best.cutAngleDeg) {
          const dir = norm(sub(b.pos, pk.center));
          best = {
            ball: b.id,
            pocket: pk.id,
            ghost: { x: b.pos.x + dir.x * 2 * R, y: b.pos.y + dir.y * 2 * R },
            cutAngleDeg: cutDeg,
          };
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  /** 本组剩余球号（open 时返回全部彩球） */
  private legalTargets(p: PlayerId): Set<string> {
    const g = p === "A" ? this.groupA : this.groupB;
    if (g === "open") return new Set([...SOLIDS, ...STRIPES]);
    const potted = g === "solids" ? this.pottedSolids : this.pottedStripes;
    const remain = [...(g === "solids" ? SOLIDS : STRIPES)].filter((x) => !potted.includes(x));
    return remain.length === 0 ? new Set(["8"]) : new Set(remain);
  }

  /** 出杆：注入当前选手手感 → 模拟 → 裁判（首触/进袋/scratch/胜负） */
  shoot(intent: {
    angle: number;
    power: number;
    spin?: { x: number; y: number; z: number };
  }): MatchShotResult {
    if (this.finished) throw new Error("对局已结束");
    const idx = this.shotIdx;
    const by = this.turn;
    const noise = noiseAtShot(this.handOf(by), idx, this.seed, this.nameOf(by));
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

    // 首触：第一个含 cue 的 ball-ball 事件
    const firstBB = r.events.find(
      (e) => e.kind === "ball-ball" && (e.a === "cue" || e.b === "cue"),
    );
    const firstContact = firstBB ? (firstBB.a === "cue" ? firstBB.b! : firstBB.a) : null;

    const pottedPockets: Array<{ ball: string; pocket: string }> = [];
    let scratch = false;
    for (const b of r.balls) {
      if (b.id === "cue") {
        if (b.pocketed) scratch = true;
        continue;
      }
      if (b.pocketed && b.pocket && !alreadyIn.has(b.id))
        pottedPockets.push({ ball: b.id, pocket: b.pocket });
    }

    // ---- 裁判 ----
    const legal = this.legalTargets(by);
    let foul: string | null = null;
    if (firstContact !== null && !legal.has(firstContact)) {
      foul = `首触错组（${firstContact}）`;
    }
    if (scratch) foul = "母球进袋（scratch）";

    const eightIn = pottedPockets.find((p) => p.ball === "8");
    const ownPots = pottedPockets.filter((p) => legal.has(p.ball));

    // 8 的处理
    if (eightIn) {
      const clearedBefore = legal.has("8"); // 本组已清空才合法打 8
      if (clearedBefore && !scratch) {
        this.over_ = true;
        this.winner = by;
        this.reason = "合法打进 8 号——胜";
      } else {
        this.over_ = true;
        this.winner = by === "A" ? "B" : "A";
        this.reason = scratch ? "打 8 时母球进袋——判负" : "提前打进 8 号——判负";
      }
    }

    // open table 定组：合法且非 8 的进球
    if (!this.over_ && this.groupA === "open" && ownPots.length > 0 && !foul) {
      const g = SOLIDS.has(ownPots[0]!.ball) ? "solids" : "stripes";
      if (by === "A") {
        this.groupA = g;
        this.groupB = g === "solids" ? "stripes" : "solids";
      } else {
        this.groupB = g;
        this.groupA = g === "solids" ? "stripes" : "solids";
      }
    }

    // 记录进袋
    for (const p of pottedPockets) {
      if (SOLIDS.has(p.ball)) this.pottedSolids.push(p.ball);
      else if (STRIPES.has(p.ball)) this.pottedStripes.push(p.ball);
    }
    this.balls = r.balls;
    this.shotIdx += 1;

    // 换手判定：犯规或没进自己组的球 → 换人
    let nextTurn: PlayerId = by;
    let continueTurn: boolean = !this.over_ && !foul && ownPots.length > 0;
    if (!this.over_ && (foul || ownPots.length === 0)) {
      nextTurn = by === "A" ? "B" : "A";
    }
    this.turn = nextTurn;

    // scratch 母球重置（v1：开球点，被挡向右顺延）
    if (scratch && !this.over_) {
      const cueBall = this.balls.find((b) => b.id === "cue")!;
      cueBall.pocketed = false;
      cueBall.pocket = undefined;
      let x = this.table.width / 2;
      const y = this.table.height * 0.75;
      const R = DEFAULT_BALL.R;
      while (
        this.balls.some(
          (b) => !b.pocketed && b.id !== "cue" && Math.hypot(b.pos.x - x, b.pos.y - y) < 2 * R,
        )
      ) {
        x += R;
      }
      cueBall.pos = vec2(x, y);
      cueBall.vel = vec2(0, 0);
      cueBall.w = { x: 0, y: 0, z: 0 };
    }

    if (!this.over_ && this.shotIdx >= this.maxShots) {
      this.over_ = true;
      this.reason = "杆数预算耗尽——平局";
      this.winner = null;
    }

    const finalPos: Record<string, { x: number; y: number }> = {};
    for (const b of r.balls) finalPos[b.id] = { x: b.pos.x, y: b.pos.y };

    return {
      shot: idx,
      byPlayer: by,
      pottedBalls: pottedPockets.map((p) => p.ball),
      pottedPockets,
      scratch,
      firstContact,
      foul,
      nextTurn: this.turn,
      continueTurn: continueTurn,
      over: this.over_,
      winner: this.winner,
      reason: this.reason,
      finalPos,
      samples: r.samples,
      events: r.events,
    };
  }
}
