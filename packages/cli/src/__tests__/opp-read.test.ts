/**
 * 读对手证据链测试：注入测量（意图角 vs 母球出射角）、对手过滤、新局重置
 */
import { describe, expect, it } from "vitest";
import { OppTracker, type ShotFactLike } from "../opp-read.ts";

function fact(
  intentAngle: number,
  cueHeading: number,
  overrides: Partial<ShotFactLike> = {},
): ShotFactLike {
  return { shot: 1, by: "B", intentAngle, cueHeading, ...overrides };
}

describe("OppTracker 证据链（意图角 vs 母球出射角）", () => {
  it("差值 = cueHeading − intentAngle（含 180° 环绕归一）", () => {
    const t = new OppTracker();
    t.ingest(fact(10.0, 10.12)); // +0.12 注入
    t.ingest(fact(-179.5, 179.6, { shot: 2 })); // 环绕：实际差 -0.9? 归一到 (+359.1→)-0.9
    expect(t.rows[0]!.biasEstDeg).toBeCloseTo(0.12, 3);
    expect(t.rows[1]!.biasEstDeg).toBeCloseTo(-0.9, 2);
  });

  it("系统性偏差的多杆一致性可归纳（同号同量级）", () => {
    const t = new OppTracker();
    // 对手真实 bias=+0.1°，每杆叠加零均值小噪声
    t.ingest(fact(0, 0.13));
    t.ingest(fact(45, 45.08, { shot: 2 }));
    t.ingest(fact(-90, -89.89, { shot: 3 }));
    t.ingest(fact(120, 120.15, { shot: 4 }));
    const vals = t.rows.map((r) => r.biasEstDeg);
    expect(vals.every((v) => v > 0)).toBe(true);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(mean).toBeCloseTo(0.1, 1);
  });

  it("只收集对手的杆", () => {
    const t = new OppTracker();
    t.opponent = "B";
    t.ingest(fact(0, 0.5, { by: "A" })); // 自己的杆不入证据
    expect(t.usable()).toBe(0);
    t.ingest(fact(0, 0.5, { by: "B", shot: 2 }));
    expect(t.usable()).toBe(1);
  });

  it("缺 intentAngle 或 cueHeading 不入证据", () => {
    const t = new OppTracker();
    t.ingest(fact(0, 0.1, { cueHeading: null }));
    t.ingest(fact(0, 0.1, { intentAngle: null, shot: 2 }));
    expect(t.usable()).toBe(0);
  });

  it("｜差值｜>1° 视为测量污染丢弃（贴球碰撞/重置帧）", () => {
    const t = new OppTracker();
    t.ingest(fact(0, -27.0)); // 污染 → 丢
    t.ingest(fact(10, 10.12, { shot: 2 })); // 正常 +0.12 → 收
    expect(t.usable()).toBe(1);
    expect(t.rows[0]!.biasEstDeg).toBeCloseTo(0.12, 3);
  });

  it("新局：杆号回退清空测量行", () => {
    const t = new OppTracker();
    t.ingest(fact(0, 0.1));
    t.ingest(fact(10, 10.1, { shot: 2 }));
    expect(t.usable()).toBe(2);
    t.ingest(fact(0, -0.1, { shot: 0 })); // 回退 → 新局重置后仅留本杆
    expect(t.usable()).toBe(1);
    expect(t.rows[0]!.shot).toBe(0);
  });

  it("render 含约定说明与逐杆差值", () => {
    const t = new OppTracker();
    t.ingest(fact(0, 0.12));
    const text = t.render();
    expect(text).toContain("opponent_shot_evidence");
    expect(text).toContain("系统性偏差");
    expect(text).toContain("0.12");
  });
});
