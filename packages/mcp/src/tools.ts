/**
 * PoolHall MCP server 工具定义（docs/proto.md 工具面）
 *
 * 原则：工具面与 CLI 命令面 1:1（同一套 core 逻辑）；schema 复用 zod（Standard Schema 兼容）。
 * MCP 会话与 CLI 的 `--driver external` 完全同构。
 */
import { z } from "zod";

export const TOOL_OBSERVE = "observe_table";
export const TOOL_SHOT = "take_shot";
export const TOOL_HISTORY = "get_shot_history";
export const TOOL_SCORE = "get_score";

/** 出杆输入（MCP 工具） */
export const ShotInputSchema = z.object({
  angle: z.number().finite().describe("出杆角（度，0=+x，屏幕逆时针为正）"),
  power: z.number().min(0).max(1).describe("力度 0~1（0.05 轻推/0.5 中速/1 满力）"),
  prediction: z.string().max(2000).optional().describe("可选：对轨迹/进袋的预测文本（研究用）"),
});
export type ShotInput = z.infer<typeof ShotInputSchema>;

/** 观察输出 */
export interface ObserveResult {
  trial: number;
  trialCount: number;
  score: number;
  targetPocket: string;
  balls: Array<{ id: string; x: number; y: number }>;
  pockets: Array<{ id: string; x: number; y: number }>;
  aimAssist?: {
    ghost: { x: number; y: number };
    suggestedAngle: number;
    cutAngleDeg: number;
  };
}

/** 出杆结果 */
export interface ShotResult {
  trial: number;
  potted: boolean;
  pottedPocket: string | null;
  score: number;
  finalBalls: Record<string, { x: number; y: number }>;
}

/** 历史杆记录 */
export interface HistoryEntry {
  trial: number;
  intentAngle: number;
  intentPower: number;
  potted: boolean;
  pottedPocket: string | null;
}

export const TOOL_META = [
  {
    name: TOOL_OBSERVE,
    title: "观察球桌",
    description: "获取当前校准挑战的完整观察：母球/目标球坐标、目标袋、六袋坐标、比分。",
    inputSchema: z.object({}),
  },
  {
    name: TOOL_SHOT,
    title: "出杆",
    description: "打一杆：angle（度）+ power（0~1）+ 可选 prediction。手感噪声在此注入。",
    inputSchema: ShotInputSchema,
  },
  {
    name: TOOL_HISTORY,
    title: "回看历史",
    description: "回看本局最近 N 杆的意图与结果（校准的手感原料）。",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  },
  {
    name: TOOL_SCORE,
    title: "当前比分",
    description: "进球数 / 总杆数 / 当前 trial。",
    inputSchema: z.object({}),
  },
] as const;
