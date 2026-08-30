#!/usr/bin/env node
/**
 * 中式八球对局 HTML 回放渲染器
 * 用法：node experiments/render-match.ts <match.jsonl> [-o out.html]
 *
 * 与 render-html.ts（v7 单 agent 回放）平行；本版本：A vs B 双视图逐杆并列。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type MatchMetaRow, type MatchShotRow, renderMatchHtml } from "./lib/match-html.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "figs");

interface Row extends MatchMetaRow, MatchShotRow {}
type Kind = Row["kind"];

function isShot(r: Row): r is MatchShotRow & Row {
  return r.kind === "shot";
}
function isMeta(r: Row): r is MatchMetaRow & Row {
  return r.kind === "meta";
}

function main(): void {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("-"));
  const outIdx = args.indexOf("-o");
  const outFile = outIdx >= 0 ? args[outIdx + 1]! : null;
  if (!inPath) {
    console.error("用法: node experiments/render-match.ts <match.jsonl> [-o out.html]");
    process.exit(1);
  }

  const rows: Row[] = readFileSync(inPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);

  if (!rows.some(isShot)) {
    console.error("日志里没有任何 shot 行（先跑 experiment match 生成）");
    process.exit(1);
  }

  const meta = rows.find(isMeta);
  const nameA = meta?.nameA ?? "A";
  const nameB = meta?.nameB ?? "B";
  const seed = meta?.seed ?? 0;
  const fileOut = outFile ?? join(outDir, `match-${nameA}-vs-${nameB}-s${seed}.html`);

  const html = renderMatchHtml(rows, { nameA, nameB });
  mkdirSync(dirname(fileOut), { recursive: true });
  writeFileSync(fileOut, html);
  console.log(`✓ 生成 ${fileOut}（${rows.filter(isShot).length} 杆，${nameA} vs ${nameB}）`);
}

main();
