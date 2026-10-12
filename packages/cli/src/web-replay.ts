import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMatchEventLog } from "@poolhall/core";

export interface ReplayResult {
  events: number;
  shots: number;
  bytes: number;
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function renderMatchReplay(input: string, output: string): ReplayResult {
  const events = decodeMatchEventLog(readFileSync(input, "utf8"));
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../experiments/web");
  const template = readFileSync(join(webDir, "index.html"), "utf8");
  const marker = "<!--POOLHALL_EVENTS-->";
  if (!template.includes(marker)) throw new Error("实时页面缺少 MatchEvent 嵌入标记");
  // 单文件回放：观战核心内联（style.css + table.js）；人类交互层（human.js）不进回放
  const css = readFileSync(join(webDir, "style.css"), "utf8");
  const tableJs = readFileSync(join(webDir, "table.js"), "utf8");
  const closeScript = "</script>";
  if (css.includes("</style>") || tableJs.includes(closeScript)) {
    throw new Error("前端资产含闭合标签，无法内联到单文件回放");
  }
  const payload = `<script>globalThis.POOLHALL_EVENTS=${safeScriptJson(events)};${closeScript}`;
  const linkTag = /<link\s+rel="stylesheet"\s+href="\/?style\.css"\s*\/?>/;
  const tableTag = /<script\s+src="\/?table\.js"><\/script>/;
  const humanTag = /<script\s+src="\/?human\.js"><\/script>/;
  if (!linkTag.test(template) || !tableTag.test(template) || !humanTag.test(template)) {
    throw new Error("实时页面缺少可内联的资产标签（style.css/table.js/human.js）");
  }
  const html = template
    .replace(linkTag, `<style>\n${css}\n</style>`)
    .replace(tableTag, `<script>\n${tableJs}\n${closeScript}`)
    .replace(humanTag, "")
    .replace(marker, payload)
    .replace(
      "<title>PoolHall 中式八球对局 · 实时</title>",
      "<title>PoolHall 中式八球对局 · 回放</title>",
    );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  return {
    events: events.length,
    shots: events.filter((event) => event.type === "shot").length,
    bytes: Buffer.byteLength(html),
  };
}
