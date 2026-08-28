#!/usr/bin/env node
/**
 * 回放 HTML 生成器（docs/visualization.md Step 1）
 *
 * 输入：研究日志 JSONL（research 版，含 samples/events）
 * 输出：自包含单文件 HTML（零依赖、file:// 可用、可分享）
 *
 * 用法：node experiments/render-html.ts <log.jsonl> [-o out.html]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml } from "./lib/html.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "figs");

interface ShotLog {
  kind: string;
  agent?: string;
  seed?: number;
  trial?: number;
  optimal?: number | null;
  intentAngle?: number;
  intentPower?: number;
  actualAngle?: number;
  actualPower?: number;
  biasAt?: number;
  pot?: boolean;
  pottedPocket?: string | null;
  finalBalls?: Record<string, { x: number; y: number }>;
  samples?: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>;
  events?: Array<{
    t: number;
    kind: string;
    a: string;
    b?: string;
    pocket?: string;
    cushion?: string;
  }>;
}

interface MetaLog {
  kind: string;
  agent?: string;
  seed?: number;
  trials?: number;
  promptVersion?: string;
  biasOverride?: number | null;
}

function main(): void {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("-"));
  const outIdx = args.indexOf("-o");
  const customOut = outIdx >= 0 ? args[outIdx + 1] : null;
  if (!inPath) {
    console.error("用法: node experiments/render-html.ts <log.jsonl> [-o out.html]");
    process.exit(1);
  }

  const rows = readFileSync(inPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ShotLog | MetaLog);

  const meta = rows.find((r) => r.kind === "meta") as MetaLog | undefined;
  const shots = rows.filter(
    (r) => r.kind === "shot" && Array.isArray((r as ShotLog).samples),
  ) as ShotLog[];
  if (shots.length === 0) {
    console.error("日志里没有任何带 samples 的 shot（先跑一遍 experiment calibrate 带上轨迹）");
    process.exit(1);
  }

  const agent = meta?.agent ?? "unknown";
  const seed = meta?.seed ?? 0;
  const outFile = customOut ?? join(outDir, `replay-${agent}-s${seed}.html`);

  const html = renderHtml(rows as Array<ShotLog | MetaLog>);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  console.log(`✓ 生成 ${outFile}（${shots.length} 杆，含 samples/events）`);
}

main();
