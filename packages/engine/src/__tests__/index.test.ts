import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../index.ts";

describe("engine 骨架", () => {
  it("导出语义化版本号", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
