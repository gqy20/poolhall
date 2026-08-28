/**
 * LLM agent 会话（AI SDK 驱动 + v6 接口：aimAt 点坐标 + Reflexion 账本记忆）
 *
 * 输出契约：模型给"瞄向点 (aimX, aimY)"，边界层换算出杆角——
 * atan2/符号/象限/浮点整化三类错误在接口层结构性消除。
 *
 * 日志规范：两套体系分职责——
 *   1) stderr 结构化调试日志（llmLog，JSON 行；POOLHALL_DEBUG=1 时含原文预览）：
 *      充分利用 AI SDK 自带的 result.finishReason / result.usage（onStep 数据）；
 *   2) 研究数据走 experiment.ts 的 JSONL 文件，stderr 不掺数据。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AgentObserve } from "@poolhall/core";
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { parseShotJson } from "./parser.ts";
import {
  type LedgerRow,
  promptFingerprint,
  renderFeedback,
  renderShotRequest,
  systemPrompt,
} from "./prompt.ts";

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
const DEBUG = process.env.POOLHALL_DEBUG === "1";
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
  private messages: Array<ModelMessage> = [];
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

  /** 出一杆：观察(XML+账本) → 模型 → 解析 → aimAt→angle 边界换算 */
  async shot(obs: AgentObserve): Promise<ShotAndAim | null> {
    this.messages.push({
      role: "user",
      content: renderShotRequest(obs, this.pendingFeedback, this.ledger),
    });
    this.pendingFeedback = null;

    for (let retry = 0; retry < 2; retry++) {
      const t0 = Date.now();
      try {
        const result = await generateText({
          model: this.model,
          system: systemPrompt(),
          messages: this.messages,
          temperature: 0,
          maxOutputTokens: 2048,
        });
        const u = result.usage;
        const _latency = Date.now();
        const text = result.text ?? "";
        llmLog("llm.response", {
          trial: obs.trial,
          finishReason: result.finishReason,
          tokensIn: u?.inputTokens ?? 0,
          tokensOut: u?.outputTokens ?? 0,
          textLen: text.length,
          messageCount: this.messages.length,
          latencyHint: process.env.POOLHALL_DEBUG ? Date.now() - t0 : undefined,
          preview: DEBUG ? text.slice(0, 200) : undefined,
        });

        const parsed = parseShotJson(text);
        if (!parsed) {
          this.messages.push({ role: "assistant", content: text.slice(0, 800) });
          this.messages.push({
            role: "user",
            content:
              '（无法解析。最后一行只输出：{"aimX": <瞄点x>, "aimY": <瞄点y>, "power": <0~1>, "spin": [<x>, <y>, <z>]}）',
          });
          llmLog("llm.parse_fail", { trial: obs.trial });
          continue;
        }

        this.messages.push({ role: "assistant", content: text });
        this.usageTotal.prompt += u?.inputTokens ?? 0;
        this.usageTotal.completion += u?.outputTokens ?? 0;

        const aim = this.aimOf(obs, { ...parsed, power: Number(parsed.power ?? 0) });
        llmLog("llm.parsed", { trial: obs.trial, aim, aimAssist: obs.aimAssist?.suggestedAngle });
        return aim;
      } catch (e) {
        llmLog("llm.call_error", {
          trial: obs.trial,
          error: (e as Error).message.slice(0, 200),
          retry: retry + 1,
        });
        await new Promise((r) => setTimeout(r, 1000));
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

  /** 结果反馈 + 账本追加（账本随下一杆重放——"回忆"载体） */
  feedback(
    potted: boolean,
    pottedPocket: string | null,
    finalBalls: Array<{ id: string; x: number; y: number }>,
    missDesc: string | null = null,
    ledgerRow?: Omit<LedgerRow, "sideNote"> & { sideNote?: string | null },
  ): void {
    if (ledgerRow) {
      this.ledger.push({ ...ledgerRow, sideNote: missDesc } as LedgerRow);
    }
    this.pendingFeedback = renderFeedback(potted, pottedPocket, finalBalls, missDesc);
  }

  /** 会话账本快照（research 日志用） */
  get ledgerSnapshot(): Array<LedgerRow> {
    return [...this.ledger];
  }
}
