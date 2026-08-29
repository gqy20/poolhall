/**
 * PoolHall MCP 中式八球对局工具面（docs/match.md）
 *
 * 工具面与 CLI `experiment match` 1:1：
 * - open_match:  开新对局（双选手名 + 杆数预算）
 * - observe_match: 当前选手视角观察（含你的花色组/对手花色组/aimAssists）
 * - take_match_shot: 出杆（必带 targetBall/targetPocket/aimX/aimY/power/spin）
 * - match_state: 对局详情（轮次/双方组/胜负/犯规统计）
 *
 * 一次 stdio 会话一局，工具 4 个。复现 CLI match-run 的执行流（核心逻辑复用 core/match.ts）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Group,
  type MatchObserve,
  MatchSession,
  type MatchShotResult,
  type PlayerId,
} from "@poolhall/core";
import { z } from "zod";

export const TOOL_MATCH_OPEN = "open_match";
export const TOOL_MATCH_OBSERVE = "observe_match";
export const TOOL_MATCH_SHOT = "take_match_shot";
export const TOOL_MATCH_STATE = "match_state";

/** 开局参数 */
export const OpenMatchInputSchema = z.object({
  nameA: z.string().default("playerA").describe("选手A身份名（跨局手感记忆）"),
  nameB: z.string().default("playerB").describe("选手B身份名"),
  seed: z.number().int().default(42).describe("种子（确定性 rack + bias）"),
  maxShots: z.number().int().min(1).max(120).default(60).describe("杆数预算（默认 60）"),
});
export type OpenMatchInput = z.infer<typeof OpenMatchInputSchema>;

/** 出杆输入（对局版） */
export const MatchShotInputSchema = z.object({
  targetBall: z.string().describe("目标球 id（数字 1-15，8 仅当本组清空后合法）"),
  targetPocket: z.string().describe("目标袋 id（lt/rt/lb/rb/ct/cb）"),
  aimX: z.number().finite().describe("母球瞄点 x（米）"),
  aimY: z.number().finite().describe("母球瞄点 y（米）"),
  power: z.number().min(0).max(1).describe("力度 0~1。直线球建议 < 0.5 防母球跟进"),
  spin: z
    .object({
      x: z.number().min(-1).max(1),
      y: z.number().min(-1).max(1).describe("**低杆防 scratch：直线球应设 -0.3 ~ -0.8**"),
      z: z.number().min(-1).max(1),
    })
    .optional()
    .describe("旋球向量；防 scratch 用 spin.y 负值"),
  prediction: z.string().max(2000).optional().describe("可选：出杆预测文本（研究用）"),
});
export type MatchShotInput = z.infer<typeof MatchShotInputSchema>;

export interface MatchStateResult {
  shot: number;
  turn: PlayerId;
  you: PlayerId;
  yourGroup: Group;
  oppGroup: Group;
  pottedSolids: string[];
  pottedStripes: string[];
  over: boolean;
  winner: PlayerId | null;
  reason: string | null;
  fouls: number;
}

export interface MatchShotResultMC {
  shot: number;
  by: PlayerId;
  pottedBalls: string[];
  scratch: boolean;
  firstContact: string | null;
  foul: string | null;
  nextTurn: PlayerId;
  over: boolean;
  winner: PlayerId | null;
  reason: string | null;
  finalBalls: Record<string, { x: number; y: number }>;
  continueTurn: boolean;
}

export interface MatchHistoryEntry {
  shot: number;
  by: PlayerId;
  targetBall: string;
  targetPocket: string;
  intentAngle: number;
  pottedBalls: string[];
  scratch: boolean;
  foul: string | null;
}

export const TOOL_MATCH_META = [
  {
    name: TOOL_MATCH_OPEN,
    title: "开局",
    description: "开一局中式八球对局（必传 nameA/nameB/seed/maxShots）。",
    inputSchema: OpenMatchInputSchema,
  },
  {
    name: TOOL_MATCH_OBSERVE,
    title: "观察对局",
    description: "当前选手视角：turn=你，yourGroup=你的花色组，aimAssists=每球最容易组合。",
    inputSchema: z.object({}),
  },
  {
    name: TOOL_MATCH_SHOT,
    title: "出杆（对局）",
    description: "打一杆。必带 targetBall/pocket/aim/power；直线球用 spin.y<0 防 scratch。",
    inputSchema: MatchShotInputSchema,
  },
  {
    name: TOOL_MATCH_STATE,
    title: "对局详情",
    description: "轮次、双方组、已进球、胜负、犯规总数。",
    inputSchema: z.object({}),
  },
] as const;

export interface MatchSessionState {
  session: MatchSession;
  history: Array<MatchHistoryEntry>;
  fouls: number;
  out?: string;
}

export function newMatchState(opts: OpenMatchInput & { out?: string }): MatchSessionState {
  const s: MatchSessionState = {
    session: new MatchSession({ seed: opts.seed, nameA: opts.nameA, nameB: opts.nameB, maxShots: opts.maxShots }),
    history: [],
    fouls: 0,
    out: opts.out,
  };
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    appendFileSync(
      opts.out,
      JSON.stringify({
        kind: "meta",
        mode: "match",
        seed: opts.seed,
        nameA: opts.nameA,
        nameB: opts.nameB,
        maxShots: opts.maxShots,
      }) + "\n",
    );
  }
  return s;
}

export function observeMatch(state: MatchSessionState): MatchObserve {
  return state.session.observe();
}

export function takeMatchShot(state: MatchSessionState, args: MatchShotInput): MatchShotResultMC {
  const spin = args.spin ?? { x: 0, y: 0, z: 0 };
  const cue = state.session.observe().balls.find((b) => b.id === "cue")!;
  const angle = (Math.atan2(-(args.aimY - cue.y), args.aimX - cue.x) * 180) / Math.PI;
  const rec: MatchShotResult = state.session.shoot({ angle, power: args.power, spin });
  state.history.push({
    shot: rec.shot,
    by: rec.byPlayer,
    targetBall: args.targetBall,
    targetPocket: args.targetPocket,
    intentAngle: angle,
    pottedBalls: rec.pottedBalls,
    scratch: rec.scratch,
    foul: rec.foul,
  });
  if (rec.foul) state.fouls += 1;
  if (state.out) {
    appendFileSync(
      state.out,
      JSON.stringify({
        kind: "shot",
        by: rec.byPlayer,
        targetBall: args.targetBall,
        targetPocket: args.targetPocket,
        intentAngle: angle,
        intentPower: args.power,
        intentSpin: spin,
        prediction: args.prediction ?? null,
        ...rec,
      }) + "\n",
    );
  }
  return {
    shot: rec.shot,
    by: rec.byPlayer,
    pottedBalls: rec.pottedBalls,
    scratch: rec.scratch,
    firstContact: rec.firstContact,
    foul: rec.foul,
    nextTurn: rec.nextTurn,
    over: rec.over,
    winner: rec.winner,
    reason: rec.reason,
    finalBalls: rec.finalPos,
    continueTurn: rec.continueTurn,
  };
}

export function matchState(state: MatchSessionState): MatchStateResult {
  const r = state.session.result;
  return {
    shot: r.shots,
    turn: state.session.currentTurn,
    you: state.session.currentTurn,
    yourGroup: state.session.groups[state.session.currentTurn],
    oppGroup: state.session.groups[state.session.currentTurn === "A" ? "B" : "A"],
    pottedSolids: state.session.observe().pottedSolids,
    pottedStripes: state.session.observe().pottedStripes,
    over: state.session.finished,
    winner: r.winner,
    reason: r.reason,
    fouls: state.fouls,
  };
}
