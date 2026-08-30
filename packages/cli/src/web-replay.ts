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
  const here = dirname(fileURLToPath(import.meta.url));
  const template = readFileSync(join(here, "../../../experiments/web/index.html"), "utf8");
  const marker = "<!--POOLHALL_EVENTS-->";
  if (!template.includes(marker)) throw new Error("实时页面缺少 MatchEvent 嵌入标记");
  const closeScript = "</script>";
  const payload = `<script>globalThis.POOLHALL_EVENTS=${safeScriptJson(events)};${closeScript}`;
  const html = template
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
