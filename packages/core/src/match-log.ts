/**
 * 中式八球公开事件流（观战与回放共用）。
 *
 * 这里只允许公开的意图、裁判结果与物理轨迹；hand model、实际注入角度等
 * research 字段必须留在服务侧日志中。
 */
import { z } from "zod";

export const MATCH_EVENT_SCHEMA = 4 as const;

const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const PlayerSchema = z.enum(["A", "B"]);
const DeltaSampleSchema = z.object({
  t: z.number().finite(),
  pos: z.record(z.string(), PositionSchema),
  removed: z.array(z.string()),
});
export const MatchPublicPlanSchema = z.object({
  observation: z.string().max(160),
  choice: z.string().max(160),
  cuePlan: z.string().max(160),
  risk: z.string().max(160),
  confidence: z.enum(["low", "medium", "high"]),
});

export interface DenseMatchSample {
  t: number;
  pos: Record<string, { x: number; y: number }>;
}

export const MatchHelloEventSchema = z.object({
  type: z.literal("hello"),
  schema: z.literal(MATCH_EVENT_SCHEMA),
  seed: z.number().int(),
  nameA: z.string(),
  nameB: z.string(),
  promptA: z.string().nullable(),
  promptB: z.string().nullable(),
  maxShots: z.number().int().min(1).max(120).optional(),
  table: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    breakLineX: z.number().nonnegative(),
    footSpotX: z.number().positive(),
  }),
});

export const MatchShotEventSchema = z.object({
  type: z.literal("shot"),
  schema: z.literal(MATCH_EVENT_SCHEMA),
  trial: z.number().int().nonnegative(),
  by: PlayerSchema,
  targetBall: z.string().nullable(),
  targetPocket: z.string().nullable(),
  intentAngle: z.number().finite().nullable(),
  intentPower: z.number().min(0).max(1).nullable(),
  intentSpin: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  publicPlan: MatchPublicPlanSchema.nullable(),
  review: z.string().max(240),
  pottedBalls: z.array(z.string()),
  pottedPockets: z.array(z.object({ ball: z.string(), pocket: z.string() })),
  scratch: z.boolean(),
  firstContact: z.string().nullable(),
  /** 母球初始出射角（度，出杆角约定）——可观测物理量；与 intentAngle 之差即本杆注入（bias+ε） */
  cueHeading: z.number().finite().nullable().optional(),
  foul: z.string().nullable(),
  nextTurn: PlayerSchema,
  over: z.boolean(),
  winner: PlayerSchema.nullable(),
  reason: z.string().nullable(),
  sampleMode: z.literal("delta-v1"),
  samples: z.array(DeltaSampleSchema),
  cueFinal: PositionSchema.nullable(),
  finalBalls: z.record(z.string(), PositionSchema),
});

export const MatchSummaryEventSchema = z.object({
  type: z.literal("summary"),
  schema: z.literal(MATCH_EVENT_SCHEMA),
  winner: PlayerSchema.nullable(),
  reason: z.string().nullable(),
  shots: z.number().int().nonnegative(),
});

/** 读人事件（心理层）：选手提交对对手偏差的估计与服务端带噪声评分 */
export const MatchReadEventSchema = z.object({
  type: z.literal("read"),
  schema: z.literal(MATCH_EVENT_SCHEMA),
  shot: z.number().int().nonnegative(),
  reader: PlayerSchema,
  target: PlayerSchema,
  estimateDeg: z.number().finite(),
  /** 服务端返回的带噪声误差（度，非负）；真实偏差永不出库 */
  errorDeg: z.number().finite().nonnegative(),
  directionCorrect: z.boolean(),
  attemptsLeft: z.number().int().nonnegative(),
  /** 读者推理摘要（模型原文，可选）：视频/观众叙事的黄金素材 */
  rationale: z.string().max(240).optional(),
});

export const MatchEventSchema = z.discriminatedUnion("type", [
  MatchHelloEventSchema,
  MatchShotEventSchema,
  MatchReadEventSchema,
  MatchSummaryEventSchema,
]);
export type MatchHelloEvent = z.infer<typeof MatchHelloEventSchema>;
export type MatchShotEvent = z.infer<typeof MatchShotEventSchema>;
export type MatchReadEvent = z.infer<typeof MatchReadEventSchema>;
export type MatchSummaryEvent = z.infer<typeof MatchSummaryEventSchema>;
export type MatchEvent = z.infer<typeof MatchEventSchema>;
export type MatchDeltaSample = z.infer<typeof DeltaSampleSchema>;
export type MatchPublicPlan = z.infer<typeof MatchPublicPlanSchema>;

export const MATCH_EVENT_FORBIDDEN_KEYS = [
  "actual",
  "bias",
  "optimal",
  "sigma",
  "drift",
  "hand",
  "noise",
] as const;

/** 公开事件的运行时泄漏红线：递归检查字段名，值中的自然语言不参与判定。 */
export function assertPublicMatchEvent(event: MatchEvent): void {
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const forbidden = MATCH_EVENT_FORBIDDEN_KEYS.find((word) => lower.includes(word));
      if (forbidden) throw new Error(`观战事件泄漏隐藏字段：${path}${key}`);
      visit(child, `${path}${key}.`);
    }
  };
  visit(event, "");
}

/** 跨进程边界统一入口：先校验 schema，再执行隐藏字段红线。 */
export function parsePublicMatchEvent(payload: unknown): MatchEvent {
  assertPublicMatchEvent(payload as MatchEvent);
  const event = MatchEventSchema.parse(payload);
  return event;
}

function clonePositions(
  positions: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(positions).sort()) {
    const pos = positions[id]!;
    result[id] = { x: pos.x, y: pos.y };
  }
  return result;
}

/** 固定步幅取样并按上一保留帧做稀疏差分；首帧永远是完整球位。 */
export function compactMatchSamples(samples: DenseMatchSample[], stride = 3): MatchDeltaSample[] {
  if (!Number.isInteger(stride) || stride < 1) throw new Error("轨迹 stride 必须是正整数");
  if (samples.length === 0) return [];
  const selected = samples.filter((_, index) => index % stride === 0);
  const last = samples.at(-1)!;
  if (selected.at(-1) !== last) selected.push(last);

  let previous: Record<string, { x: number; y: number }> = {};
  return selected.map((sample, index) => {
    const removed = Object.keys(previous)
      .filter((id) => !(id in sample.pos))
      .sort();
    const changed: Record<string, { x: number; y: number }> = {};
    for (const id of Object.keys(sample.pos).sort()) {
      const pos = sample.pos[id]!;
      const before = previous[id];
      if (index === 0 || !before || before.x !== pos.x || before.y !== pos.y) {
        changed[id] = { x: pos.x, y: pos.y };
      }
    }
    previous = sample.pos;
    return { t: sample.t, pos: changed, removed };
  });
}

/** 将 delta-v1 恢复成逐帧完整球位，供播放器与离线工具消费。 */
export function expandMatchSamples(samples: MatchDeltaSample[]): DenseMatchSample[] {
  const state: Record<string, { x: number; y: number }> = {};
  return samples.map((sample) => {
    for (const id of sample.removed) delete state[id];
    for (const [id, pos] of Object.entries(sample.pos)) state[id] = { x: pos.x, y: pos.y };
    return { t: sample.t, pos: clonePositions(state) };
  });
}

export function encodeMatchEvent(event: MatchEvent): string {
  return JSON.stringify(parsePublicMatchEvent(event));
}

export function decodeMatchEventLine(line: string): MatchEvent {
  const payload = JSON.parse(line) as Record<string, unknown>;
  if (payload.schema === 1 || payload.schema === 2 || payload.schema === 3) {
    const legacySchema = payload.schema;
    payload.schema = MATCH_EVENT_SCHEMA;
    if (payload.type === "hello" && legacySchema === 1) {
      payload.table = {
        width: 1.9812,
        height: 0.9906,
        breakLineX: 1.9812 / 4,
        footSpotX: (1.9812 * 3) / 4,
      };
    }
    if (payload.type === "shot") {
      payload.publicPlan = null;
      payload.review = "旧版回放未记录公开复盘";
    }
  }
  return parsePublicMatchEvent(payload);
}

/** 解析并校验一整局公开事件日志的顺序约束。 */
export function decodeMatchEventLog(text: string): MatchEvent[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = lines.map((line, index) => {
    try {
      return decodeMatchEventLine(line);
    } catch (error) {
      throw new Error(`MatchEvent 第 ${index + 1} 行无效`, { cause: error });
    }
  });
  if (events[0]?.type !== "hello") throw new Error("MatchEvent 日志首条必须是 hello");
  let shots = 0;
  for (const [index, event] of events.entries()) {
    if (event.type === "hello" && index !== 0) throw new Error("MatchEvent 日志只能有一个 hello");
    if (event.type === "shot") {
      if (event.trial !== shots)
        throw new Error(`MatchEvent 杆号不连续：期待 ${shots}，得到 ${event.trial}`);
      shots++;
    }
    if (event.type === "read" && event.shot > shots) {
      throw new Error(`MatchEvent 读人杆号超前：read.shot=${event.shot}，当前 ${shots}`);
    }
    if (event.type === "summary") {
      if (index !== events.length - 1) throw new Error("MatchEvent summary 必须是末条");
      if (event.shots !== shots)
        throw new Error(`MatchEvent summary.shots=${event.shots}，实际 ${shots}`);
    }
  }
  if (events.at(-1)?.type !== "summary") throw new Error("MatchEvent 日志末条必须是 summary");
  return events;
}
