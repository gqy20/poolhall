/**
 * generateObject 三模式稳定性对照（poolhall debug-go [n=20]）
 *
 * 背景（源码已核实，@ai-sdk/anthropic/anthropic-language-model.ts）：
 * - 'auto'（默认）：查 Anthropic 模型能力表；MiniMax-M3 不在表内 → 走伪造 json tool
 *   + tool_choice:required。实测 46% 失败（端点经常不返回 tool_use 块）。
 * - 'outputFormat'：强制 response_format:{type:'json_schema'} —— 原生结构化输出
 * - 'jsonTool'：显式走伪造 tool 路径（对照用）
 *
 * 目的：用数据定哪种模式对这个端点最稳。
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { configFromEnv } from "./llm.ts";

const MODES = ["auto", "outputFormat", "jsonTool"] as const;
type Mode = (typeof MODES)[number];

const ShotSchema = z.object({
  aimX: z.number().finite(),
  aimY: z.number().finite(),
  power: z.number().min(0).max(1),
  spin: z
    .object({
      x: z.number().min(-1).max(1),
      y: z.number().min(-1).max(1),
      z: z.number().min(-1).max(1),
    })
    .optional(),
});

const SYSTEM = "你是台球 AI Agent。给出下一杆的瞄准点与力度。";

/** 与 calibrate 实际等长的长 prompt（带账本 + 观察 JSON） */
const mkUserLong = (trial: number, withOutputInstruction: boolean): string => {
  const base = `账本（最近 5 杆）：
第1杆: 瞄(1.44, 0.51) 角度-3° → 未进，横向偏左 1.2 球径
第2杆: 瞄(1.45, 0.50) 角度-1° → 未进，横向偏左 1.0 球径
第3杆: 瞄(1.46, 0.49) 角度0° → 进袋(rt)
<observation trial="${trial}" score="2">
{"trial":${trial},"trialCount":50,"score":2,"targetPocket":"rt","balls":[{"id":"cue","x":0.3,"y":0.5},{"id":"1","x":0.5,"y":0.5}],"pockets":[{"id":"lt","x":0,"y":0},{"id":"rt","x":1.9812,"y":0},{"id":"lb","x":0,"y":0.9906},{"id":"rb","x":1.9812,"y":0.9906},{"id":"ct","x":0.9906,"y":0},{"id":"cb","x":0.9906,"y":0.9906}],"aimAssist":{"ghost":{"x":1.4714,"y":0.4953},"suggestedAngle":0,"cutAngleDeg":0}}
</observation>
目标袋 rt；母球 (0.3000, 0.5000)；目标球 (0.5000, 0.5000)。
aimAssist.ghost 是零偏差参考瞄点；结合账本决定直接瞄 ghost 还是向修正方向偏移。`;
  return withOutputInstruction
    ? `${base}
思考 2-4 行，最后一行输出 {"aimX": .., "aimY": .., "power": .., "spin": [.., .., ..]}`
    : `${base}
结合账本与观察给出你的决定。`;
};

interface Row {
  mode: string;
  trial: number;
  ok: boolean;
  err?: string;
  latencyMs: number;
  aimX?: number;
}

async function runMode(
  mode: string,
  user: string,
  n: number,
  lm: LanguageModel,
  providerMode?: Mode,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let t = 0; t < n; t++) {
    const t0 = Date.now();
    try {
      const r = await generateObject({
        model: lm,
        schema: ShotSchema,
        system: SYSTEM,
        messages: [{ role: "user", content: mkUserLong(t, user.includes("最后一行")) }],
        temperature: 0,
        maxOutputTokens: 2048,
        ...(providerMode
          ? { providerOptions: { anthropic: { structuredOutputMode: providerMode } } }
          : {}),
      });
      rows.push({ mode, trial: t, ok: true, latencyMs: Date.now() - t0, aimX: r.object.aimX });
    } catch (e) {
      rows.push({
        mode,
        trial: t,
        ok: false,
        err: (e as Error).message.slice(0, 120),
        latencyMs: Date.now() - t0,
      });
    }
  }
  return rows;
}

export async function runDebugGo(n: number): Promise<void> {
  const cfg = configFromEnv();
  const anthropic = createAnthropic({
    baseURL: `${cfg.baseUrl.replace(/\/$/, "")}/v1`,
    apiKey: cfg.apiKey,
  });
  const lm = anthropic.languageModel(cfg.model);
  console.log(`endpoint=${cfg.baseUrl} model=${cfg.model} n=${n}/组\n`);

  // 假设验证：auto 模式下，"思考后最后一行输出 JSON" 指令是否是失败触发器
  const CONDITIONS: Array<{ mode: string; instruction: boolean; providerMode?: Mode }> = [
    { mode: "long+输出指令", instruction: true, providerMode: "auto" },
    { mode: "long+无输出指令", instruction: false, providerMode: "auto" },
  ];

  const all: Row[] = [];
  for (const c of CONDITIONS) {
    process.stdout.write(`跑 ${c.mode} ... `);
    const rows = await runMode(c.mode, "", n, lm, c.providerMode);
    void c.instruction;
    all.push(...rows);
    const ok = rows.filter((r) => r.ok).length;
    console.log(`${ok}/${rows.length} (${((ok / rows.length) * 100).toFixed(0)}%)`);
  }

  console.log(`\n=== 汇总 ===`);
  for (const c of CONDITIONS) {
    const rows = all.filter((r) => r.mode === c.mode);
    const ok = rows.filter((r) => r.ok);
    const lats = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = lats.length ? lats[Math.floor(lats.length / 2)] : 0;
    console.log(
      `${c.mode.padEnd(15)} 成功 ${ok.length}/${rows.length}` +
        `  延迟p50=${p50}ms` +
        (rows.length > ok.length
          ? `  失败样例: ${rows.find((r) => !r.ok)?.err?.slice(0, 80)}`
          : ""),
    );
    if (ok.length > 0) {
      const devs = ok.map((r) => Math.abs((r.aimX ?? 0) - 1.4714)).sort((a, b) => a - b);
      console.log(
        `${"".padEnd(15)} aimX 偏差: p50=${devs[Math.floor(devs.length / 2)]?.toFixed(4)}  max=${devs[devs.length - 1]?.toFixed(4)}`,
      );
    }
  }
}
