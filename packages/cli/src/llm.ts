/**
 * Anthropic Messages 格式 LLM 客户端 + 台球 agent 循环（docs/cli.md §5 / roadmap M3）
 *
 * 环境变量（.env，Anthropic 兼容端点）：
 *   ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL
 * v0 用裸 fetch，不引 SDK（docs/tech-stack.md §3）。
 *
 * agent 循环形态：无工具、纯 JSON 输出 —— 观察（AgentView 净化 JSON）→
 * 要求模型"只输出一行 JSON {angle, power, prediction}"。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentObserve } from "@poolhall/core";

export interface LlmConfig {
  baseUrl: string;
  token: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmTurn {
  observeText: string;
  /** 有输出即调用成功 */
}

export const SYSTEM_PROMPT = `你是一个台球 AI Agent，参加一项"校准挑战赛"。

## 台面
- 美式 7 尺台：宽 1.9812m（x 轴，向右），高 0.9906m（y 轴，向下）。
- 原点在台面左上角（俯视）。x 向右增大，y 向下增大。
- 袋口 6 个：四角（lt 左上/rt 右上/lb 左下/rb 右下，袋心在角点）+ 两个中袋（ct 上边中点 / cb 下边中点）。
- 球直径 5.7cm（半径 0.0286m）。判定进球：球心进入袋口判定圆。

## 坐标速查示例（帮助校准方向感）
- 目标球 (1.5, 0.3)、右上角袋 rt 在 (1.9812, 0)、母球 (1.0, 0.3)：母球在目标球正左方、袋在正右方 → angle≈0 直线打进。
- 目标球 (0.8, 0.8)、左下角袋 lb 在 (0, 0.9906)、母球 (0.8, 0.5)：母球在目标球正下方、袋在正上方 → angle≈90 朝上打。
- angle=90 朝屏幕上方（y 减小），angle=-90 朝屏幕下方（y 增大），angle=0 朝右，angle=180/-180 朝左。

## 出杆参数
- angle：出杆方向角，单位度。angle=0 表示朝 +x（正右方）；增大表示在屏幕上逆时针旋转（angle=90 朝正上方 / −y；angle=-90 朝正下方）。
- power：[0,1]。0.05 轻推（约 0.9m/s），0.5 中等（约 4.3m/s），1.0 满力（8m/s）。

## 任务流程
每杆你会收到一个观察（JSON：目标袋 + 母球/目标球坐标 + 当前比分）。
你需要：心算几何（瞄准点=目标球身后约一个球径的 ghost 位置）→ 决定 angle 与 power → 输出一杆。

## 输出格式（必须严格遵守）
只输出一行 JSON，无其它文字：
{"angle": <number>, "power": <number>}`;

/** 从模型文本里宽容地抠出 JSON 对象 */
export function parseShotJson(text: string): { angle: number; power: number } | null {
  const m = text.match(/\{[^{}]*\}/s);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { angle?: unknown; power?: unknown };
    const angle = Number(obj.angle);
    const power = Number(obj.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return null;
    return {
      angle,
      power: Math.min(1, Math.max(0, power)),
    };
  } catch {
    return null;
  }
}

/** Anthropic Messages API 单轮调用（curl 语义的 fetch 封装） */
export type Message = { role: "user" | "assistant"; content: string };

export async function anthropicMessage(
  cfg: LlmConfig,
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.token,
      authorization: `Bearer ${cfg.token}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 512,
      temperature: cfg.temperature ?? 0,
      system,
      messages,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  return text;
}

/** 解析仓库根 .env（支持 export 前缀与注释）；文件值优先于继承的 shell env（用户意图：以 .env 为准） */
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
  const token = env("ANTHROPIC_AUTH_TOKEN");
  const baseUrl = env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com";
  const model = env("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
  return { baseUrl, model, token };
};

/** 会话式 LLM agent：messages 累积（observe → shot JSON → result → ...） */
export class LlmAgentSession {
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  private cfg: LlmConfig;

  constructor(cfg: LlmConfig = configFromEnv()) {
    this.cfg = cfg;
  }

  /** 出一杆：观察入栈 → 模型回复 → 解析（失败重试一次后放弃） */
  async shot(obs: AgentObserve): Promise<{ angle: number; power: number } | null> {
    const head = this.pending ? `${this.pending}\n\n` : "";
    this.pending = "";
    this.messages.push({
      role: "user",
      content: `${head}第 ${obs.trial + 1}/${obs.trialCount} 杆。当前比分 ${obs.score}。\n观察：${JSON.stringify(obs)}\n只输出一行 JSON。`,
    });
    for (let retry = 0; retry < 2; retry++) {
      try {
        const text = await anthropicMessage(
          this.cfg,
          SYSTEM_PROMPT,
          this.messages.map((m) => ({ role: m.role, content: m.content })),
        );
        const shot = parseShotJson(text);
        if (shot) {
          this.messages.push({ role: "assistant", content: text });
          return shot;
        }
        this.messages.push({ role: "assistant", content: text.slice(0, 500) });
        this.messages.push({
          role: "user",
          content: '（无法解析，请只输出一行 JSON：{"angle": <度数>, "power": <0到1>}）',
        });
      } catch (e) {
        this.messages.pop(); // 回滚未完成的 user 提问
        console.error(`[llm] 调用失败（${retry + 1}/2）: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  }

  /** 结果反馈（挂起，与下一次观察合并为一条 user——保持 messages 严格交替）；无任何 bias 提示 */
  feedback(
    potted: boolean,
    pottedPocket: string | null,
    finalBalls: Array<{ id: string; x: number; y: number }>,
  ): void {
    this.pending = `上一杆结果：${potted ? `进袋（${pottedPocket}袋）` : "未进"}。目标球终点：${JSON.stringify(finalBalls.filter((b) => b.id !== "cue"))}`;
  }

  private pending = "";
}

function msgText(msgs: Array<{ role: string; content: string }>): string {
  // Anthropic API 需要 messages 数组格式；这里把整个会话转成标准 messages
  return msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
}
