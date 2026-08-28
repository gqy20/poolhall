#!/usr/bin/env node
/**
 * poolhall CLI 入口（M0 占位）—— 命令面 M3 起接入 commander（docs/cli.md）
 */
import { versionBanner } from "./index.ts";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(versionBanner());
} else {
  console.log(`${versionBanner()}`);
  console.log(
    "命令面 M3 起提供（play / run / replay / render / trace / experiment），见 docs/cli.md",
  );
}
