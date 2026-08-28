import { describe, expect, it } from "vitest";
import { gaussian, nextDouble, nextInt, rangeDot, streamOf } from "../rng.ts";

describe("streamOf（计数器型 RNG）", () => {
  it("同参同流：逐字节一致", () => {
    const a = streamOf(42, "agent-x", "noise", 3);
    const b = streamOf(42, "agent-x", "noise", 3);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });

  it("不同 purpose/index/agent 产生不同流", () => {
    const g1 = streamOf(42, "a", "noise", 0);
    const g2 = streamOf(42, "a", "noise", 1);
    const g3 = streamOf(42, "b", "noise", 0);
    const g4 = streamOf(42, "a", "drift", 0);
    expect(g1.next()).not.toBe(g2.next());
    expect(g1.next()).not.toBe(g3.next());
    expect(g1.next()).not.toBe(g4.next());
  });

  it("键不粘连：(ab|c) 与 (a|bc) 不同流", () => {
    const g1 = streamOf(42, "ab", "c", 0);
    const g2 = streamOf(42, "a", "bc", 0);
    expect(g1.next()).not.toBe(g2.next());
  });
});

describe("分布", () => {
  it("nextDouble ∈ [0,1)", () => {
    const g = streamOf(7, "x", "d", 0);
    for (let i = 0; i < 1000; i++) {
      const v = nextDouble(g);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("gaussian 均值≈0、方差≈1（1万样本，粗验证）", () => {
    const g = streamOf(9, "a", "g", 0);
    const n = 10000;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const v = gaussian(g);
      sum += v;
      sum2 += v * v;
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(variance).toBeGreaterThan(0.9);
    expect(variance).toBeLessThan(1.1);
  });

  it("nextInt 在 [0,n) 内且 rangeDot 端点合理", () => {
    const g = streamOf(1, "x", "i", 0);
    for (let i = 0; i < 200; i++) {
      const v = nextInt(g, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    const h = streamOf(42, "x", "r", 0);
    for (let i = 0; i < 100; i++) {
      const v = rangeDot(h, -1, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});
