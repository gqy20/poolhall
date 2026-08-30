import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { versionBanner } from "../index.ts";

describe("cli 骨架", () => {
  it("版本横幅包含三包版本", () => {
    expect(versionBanner()).toMatch(/poolhall \d+\.\d+\.\d+ \(engine .+, core .+\)/);
  });

  it("web-match help 暴露公开事件日志选项", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const main = join(here, "../main.ts");
    const result = spawnSync(process.execPath, [main, "web-match", "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--event-out <file>");
  });

  it("replay-match help 暴露输入输出选项", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const main = join(here, "../main.ts");
    const result = spawnSync(process.execPath, [main, "replay-match", "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--in <file>");
    expect(result.stdout).toContain("--out <file>");
  });
});
