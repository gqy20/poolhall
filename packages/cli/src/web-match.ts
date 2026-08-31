import { appendFileSync, createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BREAK_LINE_X,
  encodeMatchEvent,
  FOOT_SPOT_X,
  MATCH_EVENT_SCHEMA,
  MATCH_TABLE,
  type MatchEvent,
  MatchSession,
} from "@poolhall/core";
import { attachLastShot, type EventSink, MatchHttp, readJsonBody } from "./match-http.ts";
import { runMatch } from "./match-run.ts";
import { WsHub } from "./match-ws/server.ts";
import { promptFingerprint } from "./prompt.ts";

export interface WebMatchOpts {
  host: string;
  port: string;
  seed: string;
  nameA: string;
  nameB: string;
  a: string;
  b: string;
  maxShots: string;
  out: string;
  eventOut: string;
  /** 外部选手出杆限时（秒，默认 600；0=不限时） */
  shotClock: string;
}

/** 合法选手规格（external = MCP 远程入座，M6.3） */
export const PLAYER_SPECS = new Set(["synthetic:oracle", "llm", "external"]);

/** 事件汇别名（历史兼容；单一来源在 match-http.ts） */
export type MatchEventSink = EventSink;

function startWebServer(port: number, host: string, matchHttp: MatchHttp): Promise<Server> {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../experiments/web");
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    if (path.startsWith("/match/")) {
      void handleMatchRoute(req, res, matchHttp);
      return;
    }
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404).end();
      return;
    }
    const filePath = join(webDir, "index.html");
    try {
      statSync(filePath);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404).end("experiments/web/index.html not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function createEventSink(hub: WsHub, eventOut: string): EventSink {
  if (eventOut) mkdirSync(dirname(eventOut), { recursive: true });
  return {
    broadcast(event: MatchEvent): void {
      const line = encodeMatchEvent(event);
      hub.broadcast(event);
      if (eventOut) appendFileSync(eventOut, `${line}\n`);
    },
    reset(): void {
      hub.clearHistory();
      if (eventOut) writeFileSync(eventOut, "");
    },
  };
}

function broadcastHello(
  sink: MatchEventSink,
  opts: WebMatchOpts,
  seed: number,
  maxShots: number,
): void {
  sink.broadcast({
    type: "hello",
    schema: MATCH_EVENT_SCHEMA,
    seed,
    nameA: opts.nameA,
    nameB: opts.nameB,
    promptA: opts.a === "llm" ? promptFingerprint("match").version : null,
    promptB: opts.b === "llm" ? promptFingerprint("match").version : null,
    maxShots,
    table: {
      width: MATCH_TABLE.width,
      height: MATCH_TABLE.height,
      breakLineX: BREAK_LINE_X,
      footSpotX: FOOT_SPOT_X,
    },
  });
}

/** /match/* HTTP 路由：外部选手入座层（回合门控在 MatchHttp 内部） */
async function handleMatchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  matchHttp: MatchHttp,
): Promise<void> {
  let body: unknown = null;
  if (req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "请求体过大" }));
      return;
    }
  }
  const route = matchHttp.route(req.method ?? "GET", req.url ?? "/", body);
  res.writeHead(route.status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(route.body));
}

async function playGame(
  opts: WebMatchOpts,
  sink: MatchEventSink,
  hub: WsHub,
  matchHttp: MatchHttp,
  seed: number,
  maxShots: number,
  signal: AbortSignal,
): Promise<void> {
  sink.reset();
  hub.notify({ type: "control", state: "starting", message: "新局准备中" });
  broadcastHello(sink, opts, seed, maxShots);
  const session = new MatchSession({ seed, nameA: opts.nameA, nameB: opts.nameB, maxShots });
  matchHttp.attach(session);
  matchHttp.bindReadSink((event) => sink.broadcast(event as MatchEvent));
  const hasExternal = opts.a === "external" || opts.b === "external";
  const result = await runMatch({
    specA: opts.a,
    specB: opts.b,
    nameA: opts.nameA,
    nameB: opts.nameB,
    seed,
    maxShots,
    out: opts.out || "/dev/null",
    session,
    externalShot: hasExternal
      ? (player) => {
          const name = player === "A" ? opts.nameA : opts.nameB;
          hub.notify({
            type: "control",
            state: "thinking",
            actor: player,
            message: `等待外部选手 ${name} 出杆`,
          });
          return matchHttp.waitForShot(player, signal);
        }
      : undefined,
    hub: hasExternal ? attachLastShot(sink, matchHttp) : sink,
    shouldStop: () => signal.aborted,
    onThinking: (actor) => {
      hub.notify({ type: "control", state: "thinking", actor, message: `${actor} 正在分析桌面` });
    },
    paceShot: async (shot) => {
      hub.notify({ type: "control", state: "playing", message: "AI 对局进行中" });
      const simTime = shot.samples.at(-1)?.t ?? 0;
      const waitMs = 850 + Math.max(1.5, Math.min(8, simTime)) * 1000;
      await waitForShot(waitMs, signal);
    },
  });
  if (signal.aborted) return;
  broadcastSummary(sink, result);
  hub.notify({ type: "control", state: "ready", message: "本局已生成" });
}

function waitForShot(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function broadcastSummary(
  sink: MatchEventSink,
  result: Awaited<ReturnType<typeof runMatch>>,
): void {
  sink.broadcast({
    type: "summary",
    schema: MATCH_EVENT_SCHEMA,
    winner: result.winner,
    reason: result.reason,
    shots: result.shots,
  });
  console.error(
    `对局结束：${result.winner ? `${result.winner} 胜` : "平局"}——${result.reason}（${result.shots} 杆）`,
  );
}

export async function runWebMatch(opts: WebMatchOpts): Promise<void> {
  if (!PLAYER_SPECS.has(opts.a) || !PLAYER_SPECS.has(opts.b)) {
    throw new Error(`选手规格非法（--a/--b）：可选 ${[...PLAYER_SPECS].join(" | ")}`);
  }
  const port = Number(opts.port);
  const hub = new WsHub(port, opts.host);
  await hub.start();
  const matchHttp = new MatchHttp({
    fixed: { A: opts.nameA, B: opts.nameB },
    shotClockMs: Math.max(0, Number(opts.shotClock || 600)) * 1000,
  });
  let web: Server;
  try {
    web = await startWebServer(port + 1, opts.host, matchHttp);
  } catch (error) {
    await hub.close();
    throw error;
  }
  console.error(
    `poolhall web-match 启动：WS ws://${opts.host}:${port}  HTTP http://${opts.host}:${port + 1}`,
  );
  const sink = createEventSink(hub, opts.eventOut);
  const abort = new AbortController();
  let seed = Number(opts.seed);
  let running = false;

  let resolveShutdown: () => void = () => {};
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const onSignal = (): void => {
    console.error("收到信号，关闭实时对局...");
    abort.abort();
    resolveShutdown();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const startGame = async (maxShots: number, incrementSeed: boolean): Promise<void> => {
    if (running) {
      hub.notify({ type: "control", state: "busy", message: "当前正在生成一局" });
      return;
    }
    if (incrementSeed) seed += 1;
    running = true;
    try {
      await playGame(opts, sink, hub, matchHttp, seed, maxShots, abort.signal);
    } catch (error) {
      hub.notify({ type: "control", state: "error", message: "新局生成失败" });
      console.error(error);
    } finally {
      running = false;
    }
  };
  const offControl = hub.onControl((control) => void startGame(control.maxShots, true));

  try {
    await startGame(Number(opts.maxShots), false);
    console.error("回放仍可访问；按 Ctrl-C 关闭");
    await shutdown;
  } finally {
    offControl();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await Promise.all([hub.close(), closeServer(web)]);
  }
}
