import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkEngineDeps, scanDir, scanText } from "./redline.ts";

describe("scanText", () => {
  it("干净源码零违规", () => {
    const clean = [
      'import type { Vec2 } from "./vec2.ts";',
      "export const add = (a: number, b: number): number => a + b;",
      'export * from "../index.ts";',
    ].join("\n");
    expect(scanText(clean, "clean.ts")).toEqual([]);
  });

  it("抓到随机/时钟/环境变量/IO", () => {
    const dirty = [
      "const r = Math.random();",
      "const t = Date.now();",
      "const f = fetch('http://x');",
      "if (process.env.DEBUG) {}",
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    const rules = scanText(dirty, "dirty.ts").map((v) => v.rule);
    expect(rules).toContain("随机源 Math.random");
    expect(rules).toContain("时钟 Date.now / new Date");
    expect(rules).toContain("网络 fetch");
    expect(rules).toContain("环境变量 process.env");
    expect(rules).toContain("文件系统 node:fs");
  });

  it("第三方 import 违规；相对导入与 node: 内置豁免", () => {
    const src = [
      'import { z } from "zod";',
      'import { basename } from "node:path";',
      'import { vec } from "./vec2.ts";',
      'const m = await import("pure-rand");',
    ].join("\n");
    const rules = scanText(src, "imports.ts").map((v) => v.rule);
    expect(rules).toContain('第三方依赖 import "zod"');
    expect(rules).toContain('第三方依赖 import "pure-rand"');
    expect(rules.filter((r) => r.includes("node:path"))).toHaveLength(0);
  });

  it("注释行不触发 import 误报", () => {
    expect(scanText('// import { z } from "zod"', "c.ts")).toEqual([]);
  });
});

describe("checkEngineDeps", () => {
  it("空/缺省 dependencies 通过", () => {
    expect(checkEngineDeps({})).toEqual([]);
    expect(checkEngineDeps({ dependencies: {} })).toEqual([]);
  });

  it("非空 dependencies 报违规", () => {
    const v = checkEngineDeps({ dependencies: { zod: "4.4.3" } });
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toContain("zod");
  });
});

describe("scanDir（engine 实扫）", () => {
  it("engine 源码当前干净", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const { violations, scanned } = scanDir(join(here, "..", "packages", "engine", "src"));
    expect(scanned).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
