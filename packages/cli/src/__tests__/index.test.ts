import { buildTable, makeBall, simulate, strike, vec2 } from "@poolhall/engine";
import { describe, expect, it } from "vitest";
import { renderTable, renderTrace } from "../render.ts";

const table = buildTable();

describe("renderTable", () => {
  it("空桌：边框完整、6 袋口标记、尺寸 80 列", () => {
    const out = renderTable([], table);
    const lines = out.split("\n");
    expect(lines[0]).toHaveLength(80);
    expect(out.match(/◌/g)?.length ?? 0).toBeGreaterThanOrEqual(12); // 上下边各 6 袋口标记
    expect(lines[1]).toMatch(/^◌/);
    expect(lines[1]).toMatch(/◌$/);
  });

  it("母球与目标球渲染在对应位置", () => {
    const cue = makeBall("cue", vec2(0.5, 0.5));
    const one = makeBall("1", vec2(1.5, 0.5));
    const out = renderTable([cue, one], table);
    expect(out).toContain("●");
    expect(out).toContain("1");
  });

  it("pocketed 球不画在桌上，但出现在图例", () => {
    const cue = makeBall("cue", vec2(0.5, 0.5));
    const one = makeBall("1", vec2(1.5, 0.5));
    one.pocketed = true;
    one.pocket = "lt";
    const out = renderTable([cue, one], table);
    expect(out).toContain("1:(pocketed lt)");
  });
});

describe("renderTrace", () => {
  it("逐帧输出 + 事件行", () => {
    const cue = makeBall("cue", vec2(0.5, 0.3));
    strike(cue, 90, 0.4);
    const r = simulate([cue], table);
    const out = renderTrace(r.samples, r.events, table);
    expect(out).toMatch(/^t=0\.00s {2}cue\(/);
    expect(out).toMatch(/⟶ ball-cushion cue up|⟶ pocket cue/);
  });
});
