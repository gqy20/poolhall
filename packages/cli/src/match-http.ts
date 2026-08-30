/**
 * 外部选手入座层（M6.3：双外部 Agent 同桌）
 *
 * web-match 服务端的 MatchSession 是唯一权威；外部 Agent 经 MCP remote
 * 模式走本层 HTTP 接口入座打球：
 * - POST /match/join     身份名认领桌位（A/B）
 * - GET  /match/state    公开对局状态（轮次/比分/等待谁）
 * - GET  /match/observe  当前选手视角（仅轮到自己时可用——回合门控）
 * - POST /match/shot     出杆（仅轮到自己时受理，否则 409）
 *
 * 隐藏状态红线：本层只透出 MatchSession.observe()/result 已净化的字段。
 */
import type { MatchSession, PlayerId } from "@poolhall/core";
import { z } from "zod";

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
  nameA: string;
  nameB: string;
  /** 出杆限时（毫秒）；0 = 不限时 */
  shotClockMs: number;
}

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
  readonly opts: MatchHttpOpts;

  constructor(opts: MatchHttpOpts) {
    this.opts = opts;
  }

  /** 身份名 → 桌位；与桌位不符返回 null */
  seatOf(name: string): PlayerId | null {
    if (name === this.opts.nameA) return "A";
    if (name === this.opts.nameB) return "B";
    return null;
  }

  /** 绑定本局的权威对局会话（每局一次） */
  attach(session: MatchSession): void {
    this.session = session;
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

  /** 纯路由：不碰 socket，web-match 负责读写请求体与响应 */
  route(method: string, url: string, body: unknown): HttpRoute {
    const path = url.split("?")[0]!;
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    if (method === "POST" && path === "/match/join") return this.routeJoin(body);
    if (method === "GET" && path === "/match/state") return this.routeState();
    if (method === "GET" && path === "/match/observe") return this.routeObserve(query.get("name"));
    if (method === "POST" && path === "/match/shot") return this.routeShot(body);
    return { status: 404, body: { error: `未知路由 ${method} ${path}` } };
  }

  private seats(): { A: string; B: string } {
    return { A: this.opts.nameA, B: this.opts.nameB };
  }

  private routeJoin(body: unknown): HttpRoute {
    const name =
      typeof body === "object" && body !== null && "name" in body ? String(body.name) : "";
    const seat = this.seatOf(name);
    if (!seat) return { status: 404, body: { error: "身份名与本桌席位不符", seats: this.seats() } };
    return {
      status: 200,
      body: { ok: true, seat, seats: this.seats(), shotClockMs: this.opts.shotClockMs },
    };
  }

  private routeState(): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const r = session.result;
    return {
      status: 200,
      body: {
        nameA: this.opts.nameA,
        nameB: this.opts.nameB,
        shot: r.shots,
        turn: session.currentTurn,
        groups: session.groups,
        over: session.finished,
        winner: r.winner,
        reason: r.reason,
        waitingFor: this.pending?.player ?? null,
      },
    };
  }

  private routeObserve(name: string | null): HttpRoute {
    const session = this.session;
    if (!session) return { status: 503, body: { error: "本桌尚未开局" } };
    const seat = this.seatOf(name ?? "");
    if (!seat) return { status: 404, body: { error: "身份名与本桌席位不符", seats: this.seats() } };
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
    if (!seat) return { status: 404, body: { error: "身份名与本桌席位不符", seats: this.seats() } };
    if (session.finished) return { status: 409, body: { error: "对局已结束", ...session.result } };
    if (!this.pending || this.pending.player !== seat) {
      return { status: 409, body: { error: "还没轮到你", turn: session.currentTurn } };
    }
    this.pending.resolve({ kind: "shot", shot });
    return { status: 202, body: { ok: true, by: seat } };
  }
}
