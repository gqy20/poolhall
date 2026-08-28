#!/usr/bin/env node
/**
 * poolhall-mcp · MCP server（stdio）入口
 *
 * 用法（Claude Code / pi / Codex 等 MCP 客户端）：
 *   poolhall-mcp [--seed 42] [--trials 20] [--agent <name>] [--bias-set <deg>] [--out file.jsonl]
 */
import { startStdio } from "./index.ts";

const args = process.argv.slice(2);
const get = (flag: string, d: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};

void (async () => {
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
