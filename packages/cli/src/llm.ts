/**
 * LLM agent 会话（AI SDK 驱动，M4 反馈规范化）
 *
 * 用 generateText + messages 数组替代手写会话管理（交替约束/回滚全部交给 SDK）。
 * provider 用 createAnthropic({ baseURL })——兼容 ~/.mini 式 Anthropic 兼容端点；
 * 换 OpenAI 兼容模型 = 换 provider 一行（M5 多模型对战的扩展点）。
 *
 * 结构化输出演进位：generateObject({ schema: ShotOutput })（zod，core 契约复用）——
 * v5 先保持 text + parseShotJson（部分兼容端点对 tool/object 模式支持不齐）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AgentObserve } from "@poolhall/core";
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { parseShotJson } from "./parser.ts";
import { PROMPT_VERSION, renderFeedback, renderShotRequest, SYSTEM_PROMPT } from "./prompt.ts";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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

/** usage 摘要（每次请求入研究日志，token 成本可审计） */
export interface LlmUsageRecord {
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

export class LlmAgentSession {
  private messages: Array<ModelMessage> = [];
  private pendingFeedback: string | null = null;
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
    return PROMPT_VERSION;
  }

  /** 出一杆：观察 + 挂起反馈 → SDK 消息流（交替由追加顺序保证） */
  async shot(obs: AgentObserve): Promise<{ angle: number; power: number } | null> {
    this.messages.push({
      role: "user",
      content: renderShotRequest(obs, this.pendingFeedback),
    });
    this.pendingFeedback = null;

    for (let retry = 0; retry < 2; retry++) {
      try {
        const result = await generateText({
          model: this.model,
          system: SYSTEM_PROMPT,
          messages: this.messages,
          temperature: 0,
          maxOutputTokens: 1024,
        });
        const text = result.text ?? "";
        const shot = parseShotJson(text);
        if (shot) {
          this.messages.push({ role: "assistant", content: text });
          const u = result.usage;
          this.usageTotal.prompt += u?.inputTokens ?? 0;
          this.usageTotal.completion += u?.outputTokens ?? 0;
          return shot;
        }
        // 无法解析：把原样回复留在会话里，显式纠偏一条 user
        this.messages.push({ role: "assistant", content: text.slice(0, 800) });
        this.messages.push({
          role: "user",
          content: '（无法解析。只输出一行 JSON：{"angle": <度数>, "power": <0到1>}）',
        });
      } catch (e) {
        console.error(`[llm] 调用失败（${retry + 1}/2）: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  }

  /** 结果反馈（渲染集中在 prompt.ts；挂起到下一杆的 user 消息） */
  feedback(
    potted: boolean,
    pottedPocket: string | null,
    finalBalls: Array<{ id: string; x: number; y: number }>,
    missDesc: string | null = null,
  ): void {
    this.pendingFeedback = renderFeedback(potted, pottedPocket, finalBalls, missDesc);
  }
}
