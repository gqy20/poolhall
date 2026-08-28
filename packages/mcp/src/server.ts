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

/** 启动（stdio） */
export async function startStdio(opts: ServerOpts): Promise<void> {
  const server = buildPoolhallMcp(opts);
  await server.connect(new StdioServerTransport());
}
