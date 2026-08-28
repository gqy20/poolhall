/**
 * 行协议 schema（docs/proto.md §1，M3 实现版：calibrate 模式）
 * zod 单一定义：stdio 行协议与 LLM agent 共用同一份校验。
 */
import { z } from "zod";

/** Agent → 服务：出杆 */
export const ShotMsg = z.object({
  type: z.literal("shot"),
  angle: z.number().finite(),
  power: z.number().min(0).max(1),
  spin: z.number().min(-1).max(1).optional(),
  prediction: z.string().max(2000).optional(),
});

/** Agent → 服务：预测声明（v0 记录进研究日志，不计分） */
export const PredictMsg = z.object({
  type: z.literal("predict"),
  text: z.string().max(2000),
});

/** Agent → 服务：结束 */
export const QuitMsg = z.object({ type: z.literal("quit") });

export const AgentMsg = z.discriminatedUnion("type", [ShotMsg, PredictMsg, QuitMsg]);
export type AgentMsg = z.infer<typeof AgentMsg>;
export type ShotMsgT = z.infer<typeof ShotMsg>;

/** 服务 → Agent：开局 */
export const HelloMsg = z.object({
  type: z.literal("hello"),
  schema: z.literal(1),
  mode: z.literal("calibrate"),
  agent: z.string(),
  trialCount: z.number().int().positive(),
  table: z.object({ width: z.number(), height: z.number() }),
});

/** 服务 → Agent：当前 trial 观察（AgentView 白名单字段） */
export const ObservationMsg = z.object({
  type: z.literal("observation"),
  trial: z.number().int().nonnegative(),
  trialCount: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  targetPocket: z.string(),
  balls: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
  pockets: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
  aimAssist: z
    .object({
      ghost: z.object({ x: z.number(), y: z.number() }),
      suggestedAngle: z.number(),
      cutAngleDeg: z.number(),
    })
    .optional(),
});

/** 服务 → Agent：出杆结果 */
export const ResultMsg = z.object({
  type: z.literal("result"),
  trial: z.number().int().nonnegative(),
  potted: z.boolean(),
  pottedPocket: z.string().nullable(),
  finalBalls: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
  score: z.number().int().nonnegative(),
});

/** 服务 → Agent：终局 */
export const EndMsg = z.object({
  type: z.literal("end"),
  score: z.number().int().nonnegative(),
  trialCount: z.number().int().nonnegative(),
});

export const encode = (m: object): string => JSON.stringify(m);

/** 解析 Agent 行 → 消息（含校验错误信息） */
export function decodeAgentLine(
  line: string,
): { ok: true; msg: AgentMsg } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, error: "行不是合法 JSON" };
  }
  const r = AgentMsg.safeParse(raw);
  if (r.success) return { ok: true, msg: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
