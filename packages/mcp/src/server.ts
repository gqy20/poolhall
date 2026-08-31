/**
 * PoolHall MCP server 主体（packages/mcp/src/server.ts）
 *
 * 每进程一会话、独占一张桌（roadmap M5 起步语义）：
 * - 工具面：observe_table / take_shot / get_shot_history / get_score（与 CLI 1:1）
 * - 手感由 server 进程内注入（core CalibSession），Agent 永不可见（docs/hand-model.md §6）
 * - research 日志走 --out JSONL（与 experiment 同款格式，共享下游出图/回放）
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { agentObserve, CalibSession, type ResearchShot } from "@poolhall/core";
import { z } from "zod";

/** MCP 文本结果助手（as const 让 type 字面量收窄，满足 registerTool 结果约束） */
const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

import { DEFAULT_BALL } from "@poolhall/engine";
import {
  type MatchSessionState,
  MatchShotInputSchema,
  matchState as matchStateFn,
  newMatchState,
  observeMatch,
  TOOL_MATCH_OBSERVE,
  TOOL_MATCH_OPEN,
  TOOL_MATCH_SHOT,
  TOOL_MATCH_STATE,
  takeMatchShot,
} from "./match-tools.ts";
import { MatchRemoteClient, RemoteMatchError } from "./remote.ts";
import type { HistoryEntry, ObserveResult, ShotInput, ShotResult } from "./tools.ts";
import { ShotInputSchema } from "./tools.ts";

export interface ServerOpts {
  /** server 种子（决定手感 bias 和 trial 布局） */
  seed: number;
  /** 每局杆数 */
  trials: number;
  /** 身份名（手感关联；跨进程重现） */
  agent: string;
  /** 可选 bias 覆盖（对照实验用） */
  biasOverride?: number;
  /** research 日志输出路径 */
  out?: string;
}

interface SessionState {
  session: CalibSession;
  log: Array<HistoryEntry>;
}

/** 把 session 的观察映射成工具输出（白名单字段，与 AgentView 同构） */
function observeOf(state: SessionState): ObserveResult {
  const obs = state.session.observe();
  return {
    trial: obs.trial,
    trialCount: obs.trialCount,
    score: obs.score,
    targetPocket: obs.targetPocket,
    balls: obs.balls,
    pockets: obs.pockets,
    aimAssist: obs.aimAssist,
  };
}

/** 出杆并落研究日志（完整三元组 + 轨迹） */
function shootOf(state: SessionState, args: ShotInput, out?: string): ShotResult {
  const rec: ResearchShot = state.session.shoot({
    angle: args.angle,
    power: args.power,
    spin: args.spin ? { x: args.spin[0], y: args.spin[1], z: args.spin[2] } : undefined,
  });
  state.log.push({
    trial: rec.trial,
    intentAngle: rec.intent.angle,
    intentPower: rec.intent.power,
    potted: rec.pot,
    pottedPocket: rec.pottedPocket,
  });
  if (out) {
    const objFinal = rec.finalPos["1"] ?? null;
    appendFileSync(
      out,
      JSON.stringify({
        kind: "shot",
        trial: rec.trial,
        intentAngle: rec.intent.angle,
        intentPower: rec.intent.power,
        actualAngle: rec.actual.angle,
        actualPower: rec.actual.power,
        optimal: rec.optimal,
        biasAt: rec.noise.biasAt,
        pot: rec.pot,
        pottedPocket: rec.pottedPocket,
        finalBalls: rec.finalPos,
        samples: rec.samples,
        events: rec.events,
        prediction: args.prediction ?? null,
      }) + "\n",
    );
    void objFinal;
  }
  return {
    trial: rec.trial,
    potted: rec.pot,
    pottedPocket: rec.pottedPocket,
    score: state.session.result().score,
    finalBalls: rec.finalPos,
  };
}

/** 构建 MCP server（stdio） */
export function buildPoolhallMcp(opts: ServerOpts): McpServer {
  const server = new McpServer({ name: "poolhall", version: "0.1.0" });
  const state: SessionState = {
    session: new CalibSession({
      seed: opts.seed,
      agent: opts.agent,
      trialCount: opts.trials,
      biasOverride: opts.biasOverride,
    }),
    log: [],
  };

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    appendFileSync(
      opts.out,
      JSON.stringify({
        kind: "meta",
        agent: opts.agent,
        seed: opts.seed,
        trials: opts.trials,
        biasOverride: opts.biasOverride ?? null,
      }) + "\n",
    );
  }

  server.registerTool(
    "observe_table",
    {
      description: "观察球桌：母球/目标球坐标、目标袋、六袋坐标、比分。返回 AgentView 净化字段。",
      inputSchema: {},
    },
    async () => textResult(JSON.stringify(observeOf(state))),
  );

  server.registerTool(
    "take_shot",
    {
      description:
        "出杆（angle 度 + power 0~1 + 可选 prediction）。手感噪声在此注入——你拿到的只有结果。",
      inputSchema: ShotInputSchema,
    },
    async (args: unknown) => {
      const input = ShotInputSchema.parse(args);
      return {
        content: [{ type: "text", text: JSON.stringify(shootOf(state, input, opts.out)) }],
      };
    },
  );

  server.registerTool(
    "get_shot_history",
    {
      description: "回看本局最近 N 杆的意图与结果（校准的手感原料）。",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
    },
    async (args: unknown) => {
      const { limit } = z
        .object({ limit: z.number().int().min(1).max(20).default(10) })
        .parse(args);
      return textResult(JSON.stringify(state.log.slice(-limit)));
    },
  );

  server.registerTool(
    "get_score",
    {
      description: "当前比分（进球数 / 杆数 / trial）。",
      inputSchema: {},
    },
    async () =>
      textResult(
        JSON.stringify({
          score: state.session.result().score,
          trials: state.session.result().trialCount,
          trial: state.session.trial,
        }),
      ),
  );

  return server;
}

/** match server 启动参数（独立 stdio 入口） */
export interface MatchServerOpts {
  seed: number;
  nameA: string;
  nameB: string;
  maxShots: number;
  out?: string;
}

/** 构建中式八球对局 MCP server（独立 stdio 入口） */
export function buildPoolhallMatchMcp(opts: MatchServerOpts): McpServer {
  const server = new McpServer({ name: "poolhall-match", version: "0.1.0" });
  const state: MatchSessionState = newMatchState({
    nameA: opts.nameA,
    nameB: opts.nameB,
    seed: opts.seed,
    maxShots: opts.maxShots,
    out: opts.out,
  });

  server.registerTool(
    TOOL_MATCH_OPEN,
    {
      description: "对局已在此 MCP 进程内初始化；返回初始 meta。",
      inputSchema: z.object({}),
    },
    async () =>
      textResult(
        JSON.stringify({
          nameA: opts.nameA,
          nameB: opts.nameB,
          seed: opts.seed,
          maxShots: opts.maxShots,
          turn: state.session.currentTurn,
          yourGroup: state.session.groups[state.session.currentTurn],
        }),
      ),
  );

  server.registerTool(
    TOOL_MATCH_OBSERVE,
    {
      description: "当前选手视角：turn=你、yourGroup、aimAssists=每球最容易组合的参考瞄点。",
      inputSchema: z.object({}),
    },
    async () => textResult(JSON.stringify(observeMatch(state))),
  );

  server.registerTool(
    TOOL_MATCH_SHOT,
    {
      description:
        "打一杆（必带 targetBall/pocket/aimX/aimY/power）。直线球建议 spin.y<0 防母球跟进。",
      inputSchema: MatchShotInputSchema,
    },
    async (args: unknown) => {
      const input = MatchShotInputSchema.parse(args);
      return {
        content: [{ type: "text", text: JSON.stringify(takeMatchShot(state, input)) }],
      };
    },
  );

  server.registerTool(
    TOOL_MATCH_STATE,
    {
      description: "对局详情：轮次、双方组、已进球、胜负、犯规数。",
      inputSchema: z.object({}),
    },
    async () => textResult(JSON.stringify(matchStateFn(state))),
  );

  return server;
}

/** match server 启动参数（独立 stdio 入口） */
export interface MatchServerOpts {
  seed: number;
  nameA: string;
  nameB: string;
  maxShots: number;
  out?: string;
}

/** match remote 模式启动参数（M6.3：入座 web-match 共享对局） */
export interface MatchRemoteServerOpts {
  /** web-match 的 HTTP 基址（WS 端口 + 1），如 http://127.0.0.1:8788 */
  remote: string;
  /** 身份名（必须与桌位 --name-a/--name-b 之一相符） */
  agent: string;
  fetchFn?: typeof fetch;
}

/** 预期流程错误（409 没轮到你/对局结束）转成可读 JSON；网络/服务端错误照抛 */
async function safeRemote(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RemoteMatchError) {
      const payload =
        typeof error.payload === "object" && error.payload !== null ? error.payload : {};
      return { waiting: true, status: error.status, ...payload };
    }
    throw error;
  }
}

/** 构建 remote 模式对局 MCP server（入座即绑定桌位；权威对局在 web-match 侧） */
export async function buildPoolhallMatchRemoteMcp(opts: MatchRemoteServerOpts): Promise<McpServer> {
  const client = new MatchRemoteClient(opts.remote, opts.agent, opts.fetchFn);
  const join = await client.join();
  const server = new McpServer({ name: "poolhall-match-remote", version: "0.1.0" });

  server.registerTool(
    TOOL_MATCH_OPEN,
    {
      description: "你已入座共享对局（无需开局）：返回你的桌位与对手身份。",
      inputSchema: z.object({}),
    },
    async () =>
      textResult(
        JSON.stringify({
          joined: true,
          seat: join.seat,
          you: opts.agent,
          seats: join.seats,
          shotClockMs: join.shotClockMs,
          remote: opts.remote,
        }),
      ),
  );

  server.registerTool(
    TOOL_MATCH_OBSERVE,
    {
      description:
        "你的视角观察（仅轮到你时可用）；没轮到时返回 waiting/turn，轮询 match_state 即可。",
      inputSchema: z.object({}),
    },
    async () => textResult(JSON.stringify(await safeRemote(() => client.observe()))),
  );

  server.registerTool(
    TOOL_MATCH_SHOT,
    {
      description: "打一杆（仅轮到你时受理）。直线球建议 spin.y<0 防母球跟进。",
      inputSchema: MatchShotInputSchema,
    },
    async (args: unknown) => {
      const input = MatchShotInputSchema.parse(args);
      const out = await safeRemote(() =>
        client.shot({
          aimX: input.aimX,
          aimY: input.aimY,
          power: input.power,
          spin: input.spin,
          targetBall: input.targetBall,
          targetPocket: input.targetPocket,
          prediction: input.prediction,
        }),
      );
      return textResult(JSON.stringify(out));
    },
  );

  server.registerTool(
    TOOL_MATCH_STATE,
    {
      description: "对局详情：轮次、双方组、杆数、胜负。等对手时用本工具轮询。",
      inputSchema: z.object({}),
    },
    async () => textResult(JSON.stringify(await safeRemote(() => client.state()))),
  );

  server.registerTool(
    "read_opponent",
    {
      description:
        "读对手（心理层）：提交你对对手习惯偏差的估计（度，带符号：正=偏右/顺时针，负=偏左）。" +
        "服务端返回带噪声的误差与方向是否对——从对手的意图角 vs 实际结果里归纳，别指望一次猜中。每局限次。",
      inputSchema: z.object({
        estimateDeg: z
          .number()
          .finite()
          .min(-5)
          .max(5)
          .describe("你估计的对手系统偏差（度，带符号）"),
        rationale: z
          .string()
          .max(240)
          .optional()
          .describe("推理摘要（给观众看的判断依据，会公开展示）"),
      }),
    },
    async (args: unknown) => {
      const input = z
        .object({ estimateDeg: z.number().finite(), rationale: z.string().max(240).optional() })
        .parse(args);
      return textResult(
        JSON.stringify(await safeRemote(() => client.read(input.estimateDeg, input.rationale))),
      );
    },
  );

  return server;
}

/** 启动 remote 模式 match stdio server */
export async function startMatchRemoteStdio(opts: MatchRemoteServerOpts): Promise<void> {
  const server = await buildPoolhallMatchRemoteMcp(opts);
  await server.connect(new StdioServerTransport());
}

/** 启动 match stdio server（与 calibrate 并列入口） */
export async function startMatchStdio(opts: MatchServerOpts): Promise<void> {
  const server = buildPoolhallMatchMcp(opts);
  await server.connect(new StdioServerTransport());
}

/** 启动（stdio） */
export async function startStdio(opts: ServerOpts): Promise<void> {
  const server = buildPoolhallMcp(opts);
  await server.connect(new StdioServerTransport());
}
