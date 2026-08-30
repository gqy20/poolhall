/**
 * 常驻大厅（M6.4）：多桌常驻服务 + 动态认座 + 选桌观战
 *
 * 与 web-match 单桌的区别：
 * - N 桌并存；每桌独立 WsHub（不自带端口，大厅单端口按 /ws/<id> 分发）
 * - 外部席位动态认座：agent 用自己的身份名入座；身份跨局不变 →
 *   手感以服务器种子派生（handSeed），跨局肌肉记忆第一次真正生效
 * - 凑齐两人自动开局；一局结束自动续局；离席后等待新对手
 * - 单端口提供：大厅页 /、状态 /lobby/status、桌页 /table/<id>、
 *   /match/* 入座层（按 ?table= 分发）、WS /ws/<id>
 */
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  BREAK_LINE_X,
  FOOT_SPOT_X,
  MATCH_EVENT_SCHEMA,
  MATCH_TABLE,
  MatchSession,
  type PlayerId,
} from "@poolhall/core";
import { MatchHttp, readJsonBody } from "./match-http.ts";
import { runMatch } from "./match-run.ts";
import { WsHub } from "./match-ws/server.ts";
import { promptFingerprint } from "./prompt.ts";
import { createEventSink, type MatchEventSink, PLAYER_SPECS } from "./web-match.ts";

export interface LobbyOpts {
  host: string;
  /** 单端口：大厅页 + 桌页 + /match/* + /ws/<id> */
  port: string;
  /** 服务器种子：手感派生（跨局肌肉记忆）与各桌开局种子基准 */
  seed: string;
  tables: string;
  a: string;
  b: string;
  maxShots: string;
  shotClock: string;
  /** 公开日志目录（每桌 <id>.jsonl）；空 = 不落盘 */
  eventOutDir: string;
}

interface RoomConfig {
  id: string;
  specA: string;
  specB: string;
  handSeed: number;
  seedBase: number;
  maxShots: number;
  shotClockMs: number;
  /** 公开日志目录；每局一个文件 <id>-g<n>.jsonl（空 = 不落盘） */
  eventOutDir: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 一张桌：席位 + 权威对局 + 观战 hub，常驻循环“凑齐即打、打完续局” */
export class TableRoom {
  readonly id: string;
  readonly hub = new WsHub(0);
  readonly http: MatchHttp;
  private readonly cfg: RoomConfig;
  private readonly abort = new AbortController();
  private session: MatchSession | null = null;
  private gameIdx = 0;
  private playing = false;
  private stopped = false;
  private wakeSeats: (() => void) | null = null;
  private wakePause: (() => void) | null = null;
  private runner: Promise<void> | null = null;

  constructor(cfg: RoomConfig) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.http = new MatchHttp({ shotClockMs: cfg.shotClockMs });
    this.hub.onControl(() => {
      if (this.playing) {
        this.hub.notify({ type: "control", state: "busy", message: "对局进行中，结束后自动续局" });
        return;
      }
      this.wakePause?.();
      this.wakeSeats?.();
    });
  }

  status(): Record<string, unknown> {
    const s = this.session;
    return {
      id: this.id,
      specA: this.cfg.specA,
      specB: this.cfg.specB,
      state: this.playing ? "playing" : this.seatsReady() ? "ready" : "waiting",
      seats: this.http.seatNames(),
      game: this.gameIdx,
      shot: s?.result.shots ?? 0,
      turn: s?.currentTurn ?? null,
      over: s?.finished ?? false,
      winner: s?.result.winner ?? null,
      reason: s?.result.reason ?? null,
    };
  }

  start(): void {
    this.runner = this.loop().catch((error) =>
      console.error(`[lobby] 桌 ${this.id} 异常：`, error),
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    this.wakeSeats?.();
    this.wakePause?.();
    await this.runner;
    await this.hub.close();
  }

  private seatsReady(): boolean {
    return this.seatFilled("A") && this.seatFilled("B");
  }

  private seatFilled(seat: PlayerId): boolean {
    const spec = seat === "A" ? this.cfg.specA : this.cfg.specB;
    return spec !== "external" || this.http.seatNames()[seat] !== null;
  }

  private nameOf(seat: PlayerId): string {
    return this.http.seatNames()[seat] ?? `${this.id}-${seat.toLowerCase()}`;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      await this.waitSeats();
      if (this.stopped) break;
      await this.playOne();
      if (this.stopped) break;
      this.gameIdx += 1;
      this.hub.notify({ type: "control", state: "ready", message: "本局结束，即将续局" });
      await this.pause(2500);
    }
  }

  private waitSeats(): Promise<void> {
    if (this.seatsReady()) return Promise.resolve();
    this.hub.notify({ type: "control", state: "starting", message: "等待选手入座" });
    return new Promise((resolve) => {
      const off = this.http.onClaim(() => {
        if (this.seatsReady()) {
          off();
          this.wakeSeats = null;
          resolve();
        }
      });
      this.wakeSeats = () => {
        off();
        this.wakeSeats = null;
        resolve();
      };
    });
  }

  private async playOne(): Promise<void> {
    const seed = this.cfg.seedBase + this.gameIdx;
    const nameA = this.nameOf("A");
    const nameB = this.nameOf("B");
    // 每局独立公开日志（续局不截断历史局；回放按文件分局）
    const eventOut = this.cfg.eventOutDir
      ? join(this.cfg.eventOutDir, `${this.id}-g${this.gameIdx}.jsonl`)
      : "";
    const sink: MatchEventSink = createEventSink(this.hub, eventOut);
    const session = new MatchSession({
      seed,
      handSeed: this.cfg.handSeed,
      nameA,
      nameB,
      maxShots: this.cfg.maxShots,
    });
    this.session = session;
    this.http.attach(session);
    this.playing = true;
    this.hub.clearHistory();
    this.broadcastHello(sink, seed, nameA, nameB);
    const result = await runMatch({
      specA: this.cfg.specA,
      specB: this.cfg.specB,
      nameA,
      nameB,
      seed,
      maxShots: this.cfg.maxShots,
      out: "/dev/null",
      session,
      externalShot: (player) => {
        this.hub.notify({
          type: "control",
          state: "thinking",
          actor: player,
          message: `等待外部选手 ${this.nameOf(player)} 出杆`,
        });
        return this.http.waitForShot(player, this.abort.signal);
      },
      hub: sink,
      onThinking: (actor) =>
        this.hub.notify({
          type: "control",
          state: "thinking",
          actor,
          message: `${this.nameOf(actor)} 正在思考`,
        }),
      paceShot: async (shot) => {
        this.hub.notify({ type: "control", state: "playing", message: "对局进行中" });
        const simTime = shot.samples.at(-1)?.t ?? 0;
        await this.pause(850 + Math.max(1.5, Math.min(8, simTime)) * 1000);
      },
      shouldStop: () => this.stopped,
    });
    this.playing = false;
    if (this.stopped) return;
    sink.broadcast({
      type: "summary",
      schema: MATCH_EVENT_SCHEMA,
      winner: result.winner,
      reason: result.reason,
      shots: result.shots,
    });
  }

  private broadcastHello(sink: MatchEventSink, seed: number, nameA: string, nameB: string): void {
    sink.broadcast({
      type: "hello",
      schema: MATCH_EVENT_SCHEMA,
      seed,
      nameA,
      nameB,
      promptA: this.cfg.specA === "llm" ? promptFingerprint("match").version : null,
      promptB: this.cfg.specB === "llm" ? promptFingerprint("match").version : null,
      maxShots: this.cfg.maxShots,
      table: {
        width: MATCH_TABLE.width,
        height: MATCH_TABLE.height,
        breakLineX: BREAK_LINE_X,
        footSpotX: FOOT_SPOT_X,
      },
    });
  }

  /** 可打断的等待（续局节奏/观战播放节流） */
  private pause(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.wakePause = null;
        this.abort.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wakePause = finish;
      this.abort.signal.addEventListener("abort", finish, { once: true });
    });
  }
}

export interface LobbyHandle {
  rooms: readonly TableRoom[];
  port: number;
  close: () => Promise<void>;
}

/** 大厅入口：起单端口服务 + N 张桌常驻循环（返回句柄，供测试/嵌入使用） */
export async function startLobby(opts: LobbyOpts): Promise<LobbyHandle> {
  if (!PLAYER_SPECS.has(opts.a) || !PLAYER_SPECS.has(opts.b)) {
    throw new Error(`选手规格非法（--a/--b）：可选 ${[...PLAYER_SPECS].join(" | ")}`);
  }
  const handSeed = Number(opts.seed);
  const count = Math.max(1, Math.min(8, Number(opts.tables) || 1));
  const shotClockMs = Math.max(0, Number(opts.shotClock || 600)) * 1000;
  const rooms = Array.from(
    { length: count },
    (_, i) =>
      new TableRoom({
        id: `t${i + 1}`,
        specA: opts.a,
        specB: opts.b,
        handSeed,
        seedBase: handSeed + i * 997,
        maxShots: Number(opts.maxShots),
        shotClockMs,
        eventOutDir: opts.eventOutDir,
      }),
  );
  const waiting = new Set<string>();
  const server = createServer((req, res) => void routeLobby(rooms, waiting, req, res));
  server.on("upgrade", (req, sock: Duplex) => dispatchUpgrade(rooms, req, sock));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(opts.port), opts.host, () => resolve());
  });
  for (const room of rooms) room.start();
  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : Number(opts.port);
  return {
    rooms,
    port: boundPort,
    close: async () => {
      await Promise.all(rooms.map((room) => room.stop()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 常驻入口：起大厅后挂到信号，Ctrl-C 优雅关闭 */
export async function runLobby(opts: LobbyOpts): Promise<void> {
  const lobby = await startLobby(opts);
  console.error(
    `poolhall lobby 开张：${lobby.rooms.length} 桌 · http://${opts.host}:${lobby.port}（大厅页 /，观战 /table/t1…）`,
  );
  await waitForSignal();
  console.error("收到信号，关闭大厅...");
  await lobby.close();
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../experiments/web");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function servePage(res: ServerResponse, file: string): void {
  const filePath = join(webDir, file);
  try {
    statSync(filePath);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end(`${file} not found`);
  }
}

async function routeLobby(
  rooms: TableRoom[],
  waiting: Set<string>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";
  const path = url.split("?")[0]!;
  const query = new URLSearchParams(url.split("?")[1] ?? "");
  if (req.method === "GET" && (path === "/" || path === "/lobby" || path === "/index.html")) {
    return servePage(res, "lobby.html");
  }
  if (req.method === "GET" && path === "/lobby/status") {
    return sendJson(res, 200, {
      tables: rooms.map((room) => room.status()),
      waiting: [...waiting],
    });
  }
  const tablePage = path.match(/^\/table\/([^/]+)$/);
  if (req.method === "GET" && tablePage) {
    if (!rooms.some((room) => room.id === tablePage[1]))
      return sendJson(res, 404, { error: "桌不存在" });
    return servePage(res, "index.html");
  }
  if (path.startsWith("/match/")) return routeMatchApi(rooms, waiting, req, res, path, query);
  sendJson(res, 404, { error: `未知路由 ${req.method} ${path}` });
}

async function routeMatchApi(
  rooms: TableRoom[],
  waiting: Set<string>,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  let body: unknown = null;
  if (req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 413, { error: "请求体过大" });
    }
  }
  const tableId = query.get("table");
  if (path === "/match/join" && !tableId) return joinLobby(rooms, waiting, res, body);
  if (path === "/match/leave" && !tableId) return leaveLobby(rooms, res, body);
  const room = rooms.find((r) => r.id === tableId);
  if (!room) return sendJson(res, 404, { error: "桌不存在", tables: rooms.map((r) => r.id) });
  const route = room.http.route(req.method ?? "GET", req.url ?? "/", body);
  sendJson(res, route.status, route.body);
}

/** 大厅认座：不带桌号的 join → 自动分配第一张有空位的桌 */
function joinLobby(
  rooms: TableRoom[],
  waiting: Set<string>,
  res: ServerResponse,
  body: unknown,
): void {
  const name = typeof body === "object" && body !== null && "name" in body ? String(body.name) : "";
  if (!name) return sendJson(res, 400, { error: "缺 name" });
  for (const room of rooms) {
    const claimed = room.http.claim(name);
    if (claimed.ok) {
      waiting.delete(name);
      return sendJson(res, 200, {
        ok: true,
        seat: claimed.seat,
        seats: room.http.seatNames(),
        shotClockMs: room.http.opts.shotClockMs,
        table: room.id,
      });
    }
  }
  waiting.add(name);
  sendJson(res, 409, { error: "大厅暂无空位，已列入等候", waiting: [...waiting] });
}

function leaveLobby(rooms: TableRoom[], res: ServerResponse, body: unknown): void {
  const name = typeof body === "object" && body !== null && "name" in body ? String(body.name) : "";
  for (const room of rooms) {
    if (room.http.leave(name)) return sendJson(res, 200, { ok: true, table: room.id });
  }
  sendJson(res, 404, { error: "未找到该席位" });
}

function dispatchUpgrade(rooms: TableRoom[], req: IncomingMessage, sock: Duplex): void {
  const matched = (req.url ?? "").match(/^\/ws\/([^/?]+)/);
  const room = matched ? rooms.find((r) => r.id === matched[1]) : undefined;
  if (!room) {
    sock.destroy();
    return;
  }
  room.hub.handleUpgrade(req, sock);
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
