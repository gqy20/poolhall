import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../index.ts";

describe("core 骨架", () => {
  it("导出版本号", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
