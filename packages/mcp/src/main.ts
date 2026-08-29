#!/usr/bin/env node
/**
 * poolhall-mcp · MCP server（stdio）入口
 *
 * 用法（Claude Code / pi / Codex 等 MCP 客户端）：
 *   poolhall-mcp                                       校准挑战 server（observe_table/take_shot/...）
 *   poolhall-mcp --match [--seed N]                   中式八球对局 server（4 工具：open/observe/shot/state）
 */
import { startStdio, startMatchStdio } from "./index.ts";

const args = process.argv.slice(2);
const get = (flag: string, d: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};

const isMatch = args.includes("--match");

void (async () => {
  if (isMatch) {
    await startMatchStdio({
      seed: Number(get("--seed", "42")),
      nameA: get("--name-a", "playerA"),
      nameB: get("--name-b", "playerB"),
      maxShots: Number(get("--max-shots", "60")),
      out: get("--out", "") || undefined,
    });
    return;
  }
  await startStdio({
    seed: Number(get("--seed", "42")),
    trials: Number(get("--trials", "20")),
    agent: get("--agent", "default"),
    biasOverride: args.includes("--bias0")
      ? 0
      : get("--bias-set", "") === ""
        ? undefined
        : Number(get("--bias-set", "0")),
    out: get("--out", "") || undefined,
  });
})();
