import { appendFileSync, createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BREAK_LINE_X,
  encodeMatchEvent,
  FOOT_SPOT_X,
  MATCH_EVENT_SCHEMA,
  MATCH_TABLE,
  type MatchEvent,
} from "@poolhall/core";
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
}

interface MatchEventSink {
  broadcast(event: MatchEvent): void;
  reset(): void;
}

function startWebServer(port: number, host: string): Promise<Server> {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../experiments/web");
  const server = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404).end();
      return;
    }
    const path = join(webDir, "index.html");
    try {
      statSync(path);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(path).pipe(res);
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

function createEventSink(hub: WsHub, eventOut: string): MatchEventSink {
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

async function playGame(
  opts: WebMatchOpts,
  sink: MatchEventSink,
  hub: WsHub,
  seed: number,
  maxShots: number,
  signal: AbortSignal,
): Promise<void> {
  sink.reset();
  hub.notify({ type: "control", state: "starting", message: "新局准备中" });
  broadcastHello(sink, opts, seed, maxShots);
  const result = await runMatch({
    specA: opts.a,
    specB: opts.b,
    nameA: opts.nameA,
    nameB: opts.nameB,
    seed,
    maxShots,
    out: opts.out || "/dev/null",
    hub: sink,
    shouldStop: () => signal.aborted,
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
  const port = Number(opts.port);
  const hub = new WsHub(port, opts.host);
  await hub.start();
  let web: Server;
  try {
    web = await startWebServer(port + 1, opts.host);
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
      await playGame(opts, sink, hub, seed, maxShots, abort.signal);
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
