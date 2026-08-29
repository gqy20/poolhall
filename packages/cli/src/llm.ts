/**
 * LLM agent 会话（AI SDK 驱动 + v8：generateObject 原生结构化输出 + Reflexion 账本记忆）
 *
 * 输出契约：zod schema（ShotOutputSchema）——模型给"瞄向点 (aimX, aimY) + 力度 + 可选 spin"，
 * 边界层换算出杆角：atan2/符号/象限/浮点整化错误在接口层结构性消除。
 * prompt 不再含输出格式约束（v6 时代"最后一行输出 JSON"已废弃——schema 就是契约）。
 *
 * 日志规范：两套体系分职责——
 *   1) stderr 结构化调试日志（llmLog，JSON 行）；
 *   2) 研究数据走 experiment.ts 的 JSONL 文件，stderr 不掺数据。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AgentObserve } from "@poolhall/core";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type LedgerRow,
  promptFingerprint,
  renderFeedback,
  renderShotRequest,
  systemPrompt,
} from "./prompt.ts";

/**
 * v8：AI SDK 原生结构化输出（generateObject + zod schema）。
 * 端点走伪造 json tool（structuredOutputMode auto，源码核实 MiniMax-M3 不在
 * Anthropic 能力表 → tool_choice:required 路径）；实测 95-100%，偶发端点抖动
 * 由外层重试覆盖。prompt 不再含输出格式约束——schema 就是契约，
 * 字段语义用 .describe() 进 JSON schema（原生机制，替代 prompt 里的 output_contract）。
 */
const ShotOutputSchema = z.object({
  aimX: z
    .number()
    .finite()
    .describe("母球出杆应瞄向的点 x（米）。通常在 aimAssist.ghost 附近，或按账本修正后的点"),
  aimY: z
    .number()
    .finite()
    .describe("母球出杆应瞄向的点 y（米）。与 aimX 同一点"),
  power: z.number().min(0).max(1).describe("力度 0~1。建议 0.3~0.5，满力走位失控"),
  spin: z
    .object({
      x: z.number().min(-1).max(1),
      y: z.number().min(-1).max(1),
      z: z.number().min(-1).max(1).describe("加塞：碰库/碰球后母球切向偏移，不需要时 0"),
    })
    .optional()
    .describe("旋球向量，可选；不确定时省略或全 0"),
  note: z
    .string()
    .max(300)
    .optional()
    .describe(
      "校准笔记（核心记忆，改写制）：一句话维护你对自身系统偏差的结论与当前修正策略" +
        "（方向/量级/是否有效），每杆按最新证据改写；无结论时省略",
    ),
});

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/** 解析仓库根 .env（支持 export 前缀与注释）；文件值优先于继承的 shell env */
function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
      "utf-8",
    );
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const kv = line.replace(/^export\s+/, "");
      const eq = kv.indexOf("=");
      if (eq <= 0) continue;
      out[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    }
  } catch {
    // 无 .env 时退回 shell env
  }
  return out;
}

export const configFromEnv = (): LlmConfig => {
  const dot = readDotEnv();
  const env = (k: string): string => dot[k] ?? process.env[k] ?? "";
  return {
    apiKey: env("ANTHROPIC_AUTH_TOKEN") || env("ANTHROPIC_API_KEY"),
    baseUrl: env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com",
    model: env("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514",
  };
};

/** 结构化调试日志（stderr JSON 行；POOLHALL_DEBUG=1 时带模型原文预览） */
export function llmLog(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

/** 出一杆的归一结果（aimAt 含"模型瞄的点"；仅 angle 兼容时为 null） */
export interface ShotAndAim {
  angle: number;
  power: number;
  aimAt: { x: number; y: number } | null;
  /** v7 spin：模型输出的 spin ∈ [-1,1]^3；undefined 表示 v6 行为（全 0） */
  spin: { x: number; y: number; z: number };
}

export class LlmAgentSession {
  /**
   * 历史以文本内嵌（非 messages 多轮）——**已两次实证**：该端点 tool-call 路径
   * （generateObject 走伪造 json tool + tool_choice:required）在 messages 含
   * assistant 历史轮时必崩（v8.1: 2/50；v8.4 判别实验排除时间窗混杂后 1/50，
   * 3 次重试全灭）；完全无历史又致补偿震荡（46%）。
   *
   * v8.6 两全设计（缓存 × 精度）：历史分两区——
   * - 归档区：旧杆压缩成一行"第N杆: 进袋/未进"（append-only，写后永不改写 → 前缀
   *   稳定可缓存，打 ephemeral 断点）
   * - 近窗区：最近 6 杆完整明细（瞄点/力度/偏差），窗口滑出即衰减 → 行为阻尼
   *   （全量明细永驻会供燃料过补偿，v8.5b 实测 68%→54%，崩坏集中在 trial 20-27）
   */
  private history: string[] = [];
  /** v9 结论层：模型自写校准笔记（改写制；null=模型尚未形成结论） */
  private note: string | null = null;
  private lastObj: {
    aimX: number;
    aimY: number;
    power: number;
    spin?: { x: number; y: number; z: number };
  } | null = null;
  private pendingFeedback: string | null = null;
  private ledger: Array<LedgerRow> = [];
  private usageTotal = { prompt: 0, completion: 0 };
  private model: LanguageModel;

  constructor(cfg: LlmConfig = configFromEnv()) {
    const anthropic = createAnthropic({
      // AI SDK 的 anthropic provider 在 baseURL 后直接拼 /messages；
      // 兼容端点按官方约定挂 /v1 下（curl 语义同 {base}/v1/messages）
      baseURL: `${cfg.baseUrl.replace(/\/$/, "")}/v1`,
      apiKey: cfg.apiKey,
    });
    this.model = anthropic.languageModel(cfg.model);
  }

  get totalUsage(): { prompt: number; completion: number } {
    return this.usageTotal;
  }

  get promptVersion(): string {
    return promptFingerprint().version;
  }

  /** 上次成功调用的用量明细（experiment 落研究日志用；SDK LanguageModelUsage 全字段） */
  lastUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    latencyMs: number;
    tokensPerSec: number;
  } | null = null;

  /** 会话累计用量（summary 落研究日志用） */
  usageSummary(): {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheHitRate: number;
    latencyMsMean: number;
    tokensPerSecMean: number;
  } {
    const n = this.callCount || 1;
    return {
      calls: this.callCount,
      inputTokens: this.usageTotal.prompt,
      outputTokens: this.usageTotal.completion,
      cacheReadTokens: this.usageCacheRead,
      cacheWriteTokens: this.usageCacheWrite,
      cacheHitRate: this.usageTotal.prompt > 0 ? this.usageCacheRead / this.usageTotal.prompt : 0,
      latencyMsMean: Math.round(this.latencyTotalMs / n),
      tokensPerSecMean:
        this.latencyTotalMs > 0 ? this.usageTotal.completion / (this.latencyTotalMs / 1000) : 0,
    };
  }

  private callCount = 0;
  private usageCacheRead = 0;
  private usageCacheWrite = 0;
  private latencyTotalMs = 0;

  /** 出一杆：观察+账本 → generateObject（schema 即契约）→ aimAt→angle 边界换算。
   *  端点偶发抖动（NoObjectGeneratedError）由 3 次重试覆盖。 */
  async shot(obs: AgentObserve): Promise<ShotAndAim | null> {
    // v9 两层记忆：结论层（模型自写校准笔记，改写制——Reflexion/Letta core memory 同构）
    // + 证据层（近窗 6 杆明细，滑动）。分层的轴是"结论/证据"而非"旧/新"。
    const noteBlock = this.note
      ? `<calibration_note>（你自己维护的校准结论，可按最新证据改写）\n${this.note}\n</calibration_note>\n`
      : "";
    const histBlock =
      this.history.length > 0
        ? `<history>（你之前的决定与结果，从旧到新）\n${this.history.slice(-6).join("\n")}\n</history>\n`
        : "";
    const userMessage = noteBlock + histBlock + renderShotRequest(obs, this.pendingFeedback, this.ledger);
    this.pendingFeedback = null;

    for (let retry = 0; retry < 3; retry++) {
      const t0 = Date.now();
      try {
        const result = await generateObject({
          model: this.model,
          schema: ShotOutputSchema,
          system: systemPrompt(),
          messages: [{ role: "user", content: userMessage }],
          temperature: 0,
          maxOutputTokens: 2048,
        });
        const u = result.usage;
        const obj = result.object;
        this.lastObj = obj;
        if (obj.note !== undefined && obj.note.trim().length > 0) this.note = obj.note.trim();
        const latencyMs = Date.now() - t0;
        const cacheRead = u?.inputTokenDetails?.cacheReadTokens ?? 0;
        const cacheWrite = u?.inputTokenDetails?.cacheWriteTokens ?? 0;
        const outTok = u?.outputTokens ?? 0;
        this.lastUsage = {
          inputTokens: u?.inputTokens ?? 0,
          outputTokens: outTok,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          reasoningTokens: u?.outputTokenDetails?.reasoningTokens ?? 0,
          latencyMs,
          tokensPerSec: latencyMs > 0 ? Math.round(outTok / (latencyMs / 1000)) : 0,
        };
        llmLog("llm.response", {
          trial: obs.trial,
          finishReason: result.finishReason ?? "stop",
          tokensIn: u?.inputTokens ?? 0,
          tokensOut: outTok,
          cacheRead,
          cacheWrite,
          latencyMs,
          tokensPerSec: this.lastUsage.tokensPerSec,
        });
        this.usageTotal.prompt += u?.inputTokens ?? 0;
        this.usageTotal.completion += outTok;
        this.usageCacheRead += cacheRead;
        this.usageCacheWrite += cacheWrite;
        this.callCount += 1;
        this.latencyTotalMs += latencyMs;

        const aim = this.aimOf(obs, obj);
        llmLog("llm.parsed", { trial: obs.trial, aim, aimAssist: obs.aimAssist?.suggestedAngle });
        return aim;
      } catch (e) {
        llmLog("llm.call_error", {
          trial: obs.trial,
          error: (e as Error).message.slice(0, 200),
          retry: retry + 1,
        });
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    llmLog("llm.give_up", { trial: obs.trial });
    return null;
  }

  /** aimAt 点 → 出杆角（atan2/符号/象限唯一集中地） */
  private aimOf(
    obs: AgentObserve,
    parsed: { aimX?: number; aimY?: number; angle?: number; power: number; spin?: { x: number; y: number; z: number } },
  ): ShotAndAim {
    const cue = obs.balls.find((b) => b.id === "cue");
    const power = Math.min(1, Math.max(0, parsed.power));
    const spin = parsed.spin ?? { x: 0, y: 0, z: 0 };
    if (cue && Number.isFinite(parsed.aimX) && Number.isFinite(parsed.aimY)) {
      return {
        angle: (Math.atan2(-(parsed.aimY! - cue.y), parsed.aimX! - cue.x) * 180) / Math.PI,
        power,
        aimAt: { x: parsed.aimX!, y: parsed.aimY! },
        spin,
      };
    }
    return { angle: Number(parsed.angle), power, aimAt: null, spin };
  }

  /** 结果反馈 + 账本/历史追加（历史块给 generateObject 单轮调用提供决策连续性） */
  feedback(
    potted: boolean,
    pottedPocket: string | null,
    finalBalls: Array<{ id: string; x: number; y: number }>,
    missDesc: string | null = null,
    ledgerRow?: Omit<LedgerRow, "sideNote"> & { sideNote?: string | null },
  ): void {
    if (this.lastObj) {
      const o = this.lastObj;
      const spin =
        o.spin && (o.spin.x || o.spin.y || o.spin.z)
          ? ` spin=(${o.spin.x},${o.spin.y},${o.spin.z})`
          : "";
      // 注：曾试过加"偏 ghost N 球径"标注，负优化（60%<68%）——诱发过度补偿，勿加回
      this.history.push(
        `第${(ledgerRow?.trial ?? this.history.length) + 1}杆: 我瞄(${o.aimX.toFixed(3)}, ${o.aimY.toFixed(3)}) 力度${o.power.toFixed(2)}${spin} → ${
          potted ? `进袋(${pottedPocket})` : `未进${missDesc ? `，${missDesc}` : ""}`
        }`,
      );
      this.lastObj = null;
    }
    if (ledgerRow) {
      this.ledger.push({ ...ledgerRow, sideNote: missDesc } as LedgerRow);
    }
    this.pendingFeedback = renderFeedback(potted, pottedPocket, finalBalls, missDesc);
  }

  /** 当前校准笔记（research 日志用） */
  get currentNote(): string | null {
    return this.note;
  }

  /** 会话账本快照（research 日志用） */
  get ledgerSnapshot(): Array<LedgerRow> {
    return [...this.ledger];
  }
}
