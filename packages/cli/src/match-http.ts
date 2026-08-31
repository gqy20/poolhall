/**
 * 外部选手入座层（M6.3：双外部 Agent 同桌；M6.4：大厅动态认座）
 *
 * 权威对局在服务端；外部 Agent 经 MCP remote 模式走本层 HTTP 接口：
 * - POST /match/join     认座：固定席位模式校验身份名，大厅模式动态认领空位
 * - POST /match/leave    离席（释放大厅空位）
 * - GET  /match/state    公开对局状态（轮次/比分/等待谁）
 * - GET  /match/observe  当前选手视角（仅轮到自己时可用——回合门控）
 * - POST /match/shot     出杆（仅轮到自己时受理，否则 409）
 *
 * 隐藏状态红线：本层只透出 MatchSession.observe()/result 已净化的字段。
 */

import type { IncomingMessage } from "node:http";
import type { MatchEvent, MatchSession, PlayerId, Store } from "@poolhall/core";
import { MATCH_EVENT_SCHEMA } from "@poolhall/core";
import { z } from "zod";

export interface EventSink {
  broadcast(event: MatchEvent): void;
  reset(): void;
}

/** 包装事件汇：把 shot 事件的公开事实（去轨迹）记入入座层 lastShot（外部选手反馈回路） */
export function attachLastShot(inner: EventSink, http: MatchHttp): EventSink {
  return {
    broadcast(event: MatchEvent): void {
      inner.broadcast(event);
      if (event.type !== "shot") return;
      const facts: Record<string, unknown> = { ...event };
      delete facts.samples;
      http.lastShot = facts;
    },
    reset(): void {
      inner.reset();
      http.lastShot = null;
    },
  };
}

/** 读请求体为 JSON（上限 64KiB；空体/非法 JSON → null，由路由层回 400） */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

/** 外部选手出杆载荷（与 mcp MatchShotInputSchema 同构，多带身份名） */
export const ExternalShotSchema = z.object({
  name: z.string().min(1),
  aimX: z.number().finite(),
  aimY: z.number().finite(),
  power: z.number().min(0).max(1),
  spin: z
    .object({
      x: z.number().min(-1).max(1),
      y: z.number().min(-1).max(1),
      z: z.number().min(-1).max(1),
    })
    .optional(),
  targetBall: z.string().min(1),
  targetPocket: z.string().min(1),
  prediction: z.string().max(2000).optional(),
});
export type ExternalShot = z.infer<typeof ExternalShotSchema>;

/** 对局循环等待外部出杆的两种结局：收到合法出杆 / 超时（判负原料） */
export type ShotWait = { kind: "shot"; shot: ExternalShot } | { kind: "timeout" };

export interface MatchHttpOpts {
  /** 出杆限时（毫秒）；0 = 不限时 */
  shotClockMs: number;
  /** 固定席位（web-match 单桌模式）：身份名预绑定。大厅模式缺省，认座时动态填充 */
  fixed?: { A: string; B: string };
  /** 战绩库（可选）：读人记录入库（读人准确率指标） */
  store?: Store;
  /** 读人广播（可选）：评分完成后向观战/回放流注入 read 事件 */
  onRead?: (event: ReadEvent) => void;
}

/** 读人公开事件载荷（与 MatchReadEvent 同构） */
export interface ReadEvent {
  type: "read";
  schema: number;
  shot: number;
  reader: PlayerId;
  target: PlayerId;
  estimateDeg: number;
  errorDeg: number;
  directionCorrect: boolean;
  attemptsLeft: number;
}

/** 每座每局读人次数上限（防把打分接口当二分 oracle 反推隐藏 bias） */
export const READ_MAX = 3;

interface PendingShot {
  player: PlayerId;
  resolve: (wait: ShotWait) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface HttpRoute {
  status: number;
  body: unknown;
}

/**
 * 外部选手入座器。纯路由函数 `route` 不碰 socket——便于单测直接断言。
 * 生命周期：每局开始前 `attach(session)`，对局循环调 `waitForShot` 等外部出杆。
 */
export class MatchHttp {
  private session: MatchSession | null = null;
  private pending: PendingShot | null = null;
  private claimed: { A: string | null; B: string | null };
  /** 读人事件转发（大厅：每局换 sink；构造时绑定当前汇） */
  private readSink: ((event: ReadEvent) => void) | null = null;
  /** 最近若干杆的公开事实环形缓冲（外部选手反馈回路；单杆 lastShot 会被对手下一杆覆盖） */
  readonly recentShots: Array<Record<string, unknown>> = [];
  private static readonly RECENT_CAP = 16;
  /** 最近一杆的公开事实（= recentShots 末元，历史兼容字段） */
  get lastShot(): Record<string, unknown> | null {
    return this.recentShots.at(-1) ?? null;
  }
  set lastShot(value: Record<string, unknown> | null) {
    if (value === null) {
      this.recentShots.length = 0;
      return;
    }
    this.recentShots.push(value);
    if (this.recentShots.length > MatchHttp.RECENT_CAP) this.recentShots.shift();
  }
  private readonly claimListeners = new Set<(seat: PlayerId, name: string) => void>();
  /** 读人限次：每座每局 READ_MAX 次，attach（新局）时重置 */
  private readAttempts: { A: number; B: number } = { A: 0, B: 0 };
  readonly opts: MatchHttpOpts;

  constructor(opts: MatchHttpOpts) {
    this.opts = opts;
    this.claimed = opts.fixed ? { A: opts.fixed.A, B: opts.fixed.B } : { A: null, B: null };
  }

  /** 身份名 → 桌位；未认座/不符返回 null */
  seatOf(name: string): PlayerId | null {
    if (this.claimed.A === name) return "A";
    if (this.claimed.B === name) return "B";
    return null;
  }

  /** 当前席位占有人（未认座为 null） */
  seatNames(): { A: string | null; B: string | null } {
    return { A: this.claimed.A, B: this.claimed.B };
  }

  /** 动态认座（大厅模式）。返回 seat 或失败原因；成功时触发 onClaim 监听 */
  claim(name: string): { ok: true; seat: PlayerId } | { ok: false; status: number; body: unknown } {
    const existing = this.seatOf(name);
    if (existing) return { ok: true, seat: existing };
    if (this.opts.fixed) {
      return {
        ok: false,
        status: 404,
        body: { error: "身份名与本桌席位不符", seats: this.seatNames() },
      };
    }
    const seat: PlayerId | null =
      this.claimed.A === null ? "A" : this.claimed.B === null ? "B" : null;
    if (!seat)
      return { ok: false, status: 409, body: { error: "本桌没有空位", seats: this.seatNames() } };
    this.claimed[seat] = name;
    for (const listener of this.claimListeners) listener(seat, name);
    return { ok: true, seat };
  }

  /** 离席：释放席位（大厅空位回收）；返回是否释放成功 */
  leave(name: string): boolean {
    const seat = this.seatOf(name);
    if (!seat || this.opts.fixed) return false;
    this.claimed[seat] = null;
    return true;
  }

  /** 认座事件订阅（大厅：凑齐两人即开局） */
  onClaim(listener: (seat: PlayerId, name: string) => void): () => void {
    this.claimListeners.add(listener);
    return () => this.claimListeners.delete(listener);
  }

  /** 预占内部（非 external）座位：防止外部 agent 抢到 oracle/llm 的座（混编规格） */
  presetSeat(seat: PlayerId, name: string): void {
    this.claimed[seat] = name;
  }

  /** 绑定读人事件汇（每局开始时调用；传 null 解绑） */
  bindReadSink(sink: ((event: ReadEvent) => void) | null): void {
    this.readSink = sink;
  }

  /** 绑定本局的权威对局会话（每局一次；同时重置读人限次） */
  attach(session: MatchSession): void {
    this.session = session;
    this.readAttempts = { A: 0, B: 0 };
  }

  /** 对局循环：等待指定选手的外部出杆（可被 AbortSignal 打断，按超时处理） */
  waitForShot(player: PlayerId, signal?: AbortSignal): Promise<ShotWait> {
    if (this.pending) throw new Error("已有等待中的外部出杆");
    return new Promise((resolve) => {
      const settle = (wait: ShotWait): void => {
        if (this.pending?.timer) clearTimeout(this.pending.timer);
        this.pending = null;
        resolve(wait);
      };
      const timer =
        this.opts.shotClockMs > 0
          ? setTimeout(() => settle({ kind: "timeout" }), this.opts.shotClockMs)
          : null;
      this.pending = { player, resolve: settle, timer };
      signal?.addEventListener("abort", () => settle({ kind: "timeout" }), { once: true });
    });
  }

  /** 纯路由：不碰 socket，服务端负责读写请求体与响应 */
  route(method: string, url: string, body: unknown): HttpRoute {
    const path = url.split("?")[0]!;
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    if (method === "POST" && path === "/match/join") return this.routeJoin(body);
    if (method === "POST" && path === "/match/leave") return this.routeLeave(body);
    if (method === "POST" && path === "/match/read") return this.routeRead(body);
    if (method === "GET" && path === "/match/state") return this.routeState();
    if (method === "GET" && path === "/match/observe") return this.routeObserve(query.get("name"));
    if (method === "POST" && path === "/match/shot") return this.routeShot(body);
    return { status: 404, body: { error: `未知路由 ${method} ${path}` } };
  }

  private nameOf(body: unknown): string {
    return typeof body === "object" && body !== null && "name" in body ? String(body.name) : "";
  }

  private routeJoin(body: unknown): HttpRoute {
    const claimed = this.claim(this.nameOf(body));
    if (!claimed.ok) return { status: claimed.status, body: claimed.body };
    return {
      status: 200,
      body: {
        ok: true,
        seat: claimed.seat,
        seats: this.seatNames(),
        shotClockMs: this.opts.shotClockMs,
      },
    };
  }

  private routeLeave(body: unknown): HttpRoute {
    const ok = this.leave(this.nameOf(body));
    return ok
      ? { status: 200, body: { ok: true } }
      : { status: 404, body: { error: "未找到该席位" } };
  }

  /** 读对手：提交对对手习惯偏差的估计 → 带噪声评分（隐藏态不出库；限次防反推） */
  private routeRead(body: unknown): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const parsed = z
      .object({ name: z.string().min(1), estimateDeg: z.number().finite().min(-5).max(5) })
      .safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: "读人载荷不合法（需 name + estimateDeg）" } };
    }
    const seat = this.seatOf(parsed.data.name);
    if (!seat) return { status: 404, body: { error: "身份名与本桌席位不符" } };
    if (session.finished) return { status: 409, body: { error: "对局已结束" } };
    const attempt = this.readAttempts[seat];
    if (attempt >= READ_MAX) {
      return {
        status: 409,
        body: { error: `本局读人已达上限（${READ_MAX} 次）`, attemptsLeft: 0 },
      };
    }
    const scored = session.scoreBiasRead(seat, parsed.data.estimateDeg, attempt);
    if (!scored) return { status: 409, body: { error: "对局已结束" } };
    this.readAttempts[seat] = attempt + 1;
    const targetName = this.seatNames()[scored.target] ?? scored.target;
    this.opts.store?.recordBiasRead(
      parsed.data.name,
      targetName,
      parsed.data.estimateDeg,
      scored.errorDeg,
      scored.directionCorrect,
    );
    const attemptsLeft = READ_MAX - (attempt + 1);
    const readEvent: ReadEvent = {
      type: "read",
      schema: MATCH_EVENT_SCHEMA,
      shot: session.result.shots,
      reader: seat,
      target: scored.target,
      estimateDeg: parsed.data.estimateDeg,
      errorDeg: Number(scored.errorDeg.toFixed(3)),
      directionCorrect: scored.directionCorrect,
      attemptsLeft,
    };
    (this.readSink ?? this.opts.onRead)?.(readEvent);
    return {
      status: 200,
      body: {
        ok: true,
        target: scored.target,
        errorDeg: Number(scored.errorDeg.toFixed(3)),
        directionCorrect: scored.directionCorrect,
        attemptsLeft,
      },
    };
  }

  private routeState(): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const r = session.result;
    return {
      status: 200,
      body: {
        seats: this.seatNames(),
        shot: r.shots,
        turn: session.currentTurn,
        groups: session.groups,
        over: session.finished,
        winner: r.winner,
        reason: r.reason,
        waitingFor: this.pending?.player ?? null,
        lastShot: this.lastShot,
        recentShots: this.recentShots,
      },
    };
  }

  private routeObserve(name: string | null): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const seat = this.seatOf(name ?? "");
    if (!seat)
      return { status: 404, body: { error: "身份名与本桌席位不符", seats: this.seatNames() } };
    if (session.finished) return { status: 409, body: { error: "对局已结束", ...session.result } };
    if (session.currentTurn !== seat) {
      return { status: 409, body: { error: "还没轮到你", turn: session.currentTurn } };
    }
    return { status: 200, body: session.observe() };
  }

  private routeShot(body: unknown): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const parsed = ExternalShotSchema.safeParse(body);
    if (!parsed.success)
      return { status: 400, body: { error: "出杆载荷不合法", detail: parsed.error.issues } };
    const shot = parsed.data;
    const seat = this.seatOf(shot.name);
    if (!seat)
      return { status: 404, body: { error: "身份名与本桌席位不符", seats: this.seatNames() } };
    if (session.finished) return { status: 409, body: { error: "对局已结束", ...session.result } };
    if (!this.pending || this.pending.player !== seat) {
      return { status: 409, body: { error: "还没轮到你", turn: session.currentTurn } };
    }
    this.pending.resolve({ kind: "shot", shot });
    return { status: 202, body: { ok: true, by: seat } };
  }
}
