import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../index.ts";

describe("mcp 骨架", () => {
  it("导出版本号", () => {
    expect(MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
