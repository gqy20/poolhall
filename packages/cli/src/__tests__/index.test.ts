import { describe, expect, it } from "vitest";
import { versionBanner } from "../index.ts";

describe("cli 骨架", () => {
  it("版本横幅包含三包版本", () => {
    expect(versionBanner()).toMatch(/poolhall \d+\.\d+\.\d+ \(engine .+, core .+\)/);
  });
});
