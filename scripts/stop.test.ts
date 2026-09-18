import { describe, expect, it } from "vitest";
import { classify } from "./stop.ts";

describe("classify · 真进程（node 本体）", () => {
  it("make dev 起的 lobby", () => {
    expect(
      classify(["node", "packages/cli/src/main.ts", "lobby", "--port", "8880", "--tables", "2"]),
    ).toBe("node");
  });

  it("pnpm bin shim 起的 web-match（带 ./node_modules/.bin/../ 前缀）", () => {
    expect(
      classify([
        "node",
        "./node_modules/.bin/../@poolhall/cli/src/main.ts",
        "web-match",
        "--port",
        "8789",
      ]),
    ).toBe("node");
  });

  it("绝对路径 node 可执行名也认（node26 / 版本后缀）", () => {
    expect(classify(["/usr/local/bin/node26", "/x/cli/src/main.ts", "lobby"])).toBe("node");
  });

  it("非服务子命令不算目标（demo / experiment / mcp）", () => {
    expect(classify(["node", "packages/cli/src/main.ts", "demo"])).toBeNull();
    expect(classify(["node", "packages/cli/src/main.ts", "experiment", "clear"])).toBeNull();
    expect(classify(["node", "packages/cli/src/main.ts", "mcp"])).toBeNull();
  });

  it("node 跑别的脚本，即便参数里写了 lobby 也不算", () => {
    expect(classify(["node", "scripts/golden.ts", "lobby"])).toBeNull();
  });
});

describe("classify · 包装层（pnpm exec）", () => {
  it("pnpm exec poolhall web-match", () => {
    expect(
      classify([
        "/home/u/.local/share/pnpm/.tools/@pnpm+linux-x64/10.33.2/node_modules/@pnpm/linux-x64/pnpm",
        "exec",
        "poolhall",
        "web-match",
        "--port",
        "8810",
      ]),
    ).toBe("wrapper");
  });

  it("pnpm exec poolhall demo 不是服务，不算目标", () => {
    expect(classify(["pnpm", "exec", "poolhall", "demo"])).toBeNull();
  });
});

describe("classify · 误杀防护（真实踩过的坑）", () => {
  it("命令行里含目标字面量的 shell 不被当成目标", () => {
    // pkill/pgrep -f 会把这类进程一起杀掉，导致清理脚本自杀、后续步骤静默丢失
    expect(classify(["/bin/bash", "-c", 'pgrep -af "cli/src/main.ts lobby"'])).toBeNull();
    expect(classify(["grep", "-rn", "poolhall web-match", "packages/"])).toBeNull();
    expect(classify(["/bin/sh", "-c", "make dev PORT=8880"])).toBeNull();
  });

  it("编辑器/查看器打开了同名文件不算", () => {
    expect(classify(["vim", "packages/cli/src/main.ts", "lobby.md"])).toBeNull();
  });

  it("空 argv / 内核线程不算", () => {
    expect(classify([])).toBeNull();
    expect(classify([""])).toBeNull();
  });
});
