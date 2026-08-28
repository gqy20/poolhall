/**
 * Anthropic Messages 格式 LLM 客户端 + 台球 agent 会话循环（docs/cli.md §5 / roadmap M3）
 *
 * 环境变量（.env，Anthropic 兼容端点；文件值优先于继承 shell env）：
 *   ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL
 *
 * 会话形态：observe(user) → shot JSON(assistant) → 结果反馈(user) → 下一杆…
 * 反馈渲染成球手可读语言（横向偏 N 球径），仍严守 AgentView 泄漏红线（docs/hand-model.md §6）。
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

export const SYSTEM_PROMPT = `你是一个台球 AI Agent，参加一项"校准挑战赛"。

## 台面
- 美式 7 尺台：宽 1.9812m（x 轴，向右），高 0.9906m（y 轴，向下）。
- 原点在台面左上角（俯视）。x 向右增大，y 向下增大。
- 袋口 6 个：四角（lt 左上/rt 右上/lb 左下/rb 右下，袋心在角点）+ 两个中袋（ct 上边中点 / cb 下边中点）。观察 JSON 的 pockets 给出精确坐标。
- 球直径 5.7cm（半径 0.0286m）。判定进球：球心进入袋口判定圆。

## 瞄准方法（ghost ball）
1. 目标球需要沿（袋心 → 目标球）方向被撞出才能进袋；
2. 因此母球必须击在目标球的 ghost 位置——目标球背离袋口方向一个球径处：
   ghost = objPos + normalize(objPos - pocketPos) × 2×radius；
3. 出杆角 = atan2(-(ghostY - cueY), ghostX - cueX)（度。注意 y 向下，所以取负号）；
4. 切角越大，几何容差越小——能选直一点的袋就别选大切角（但本挑战目标袋已指定）。

## 坐标速查（校准方向感）
- 目标球 (1.5, 0.3)、右上角袋 rt (1.9812, 0)、母球 (1.0, 0.3)：母球在目标球正左方、袋在右方 → angle≈0 直线打进。
- angle=90 朝屏幕上方（y 减小）；angle=-90 朝屏幕下方（y 增大）；angle=0 朝右；angle=180 朝左。
- 例：ghost 在母球的右上方（dx>0, dy<0）→ angle = atan2(dy 负 → 取正的度数) …总之 angle = atan2(-(ghost.y-cue.y), ghost.x-cue.x)×180/π。

## 出杆参数
- angle：出杆方向角（度，见上式）。
- power：[0,1]。0.05 轻推（约 0.9m/s），0.5 中等（约 4.3m/s），1.0 满力（8m/s）。中短距离 0.3~0.5 足够。

## 任务流程
每杆收到观察（JSON：pockets 六袋坐标 + targetPocket 目标袋 + 母球/目标球坐标 + 比分）。
上杆结果会反馈给你（进没进 / 偏了多少）——注意从中总结自己的系统性偏向并主动修正。

## 输出格式（必须严格遵守）
只输出一行 JSON，无其它文字、无代码块：
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
    return { angle, power: Math.min(1, Math.max(0, power)) };
  } catch {
    return null;
  }
}

export type Message = { role: "user" | "assistant"; content: string };

/** Anthropic Messages API 调用（curl 语义的 fetch 封装） */
export async function anthropicMessage(
  cfg: LlmConfig,
  system: string,
  messages: Array<Message>,
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
  return data.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
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
    token: env("ANTHROPIC_AUTH_TOKEN"),
    baseUrl: env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com",
    model: env("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514",
  };
};

export class LlmAgentSession {
  private messages: Array<Message> = [];
  private pending = "";

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
        const text = await anthropicMessage(this.cfg, SYSTEM_PROMPT, this.messages);
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

  /** 结果反馈（挂起，与下一次观察合并为一条 user——保持 messages 严格交替）；无 bias 提示 */
  feedback(
    potted: boolean,
    pottedPocket: string | null,
    finalBalls: Array<{ id: string; x: number; y: number }>,
    missDesc: string | null = null,
  ): void {
    const base = potted
      ? `上一杆结果：进袋（${pottedPocket}）。`
      : `上一杆结果：未进${missDesc ? `（${missDesc}）` : ""}。`;
    this.pending = base;
  }
}
