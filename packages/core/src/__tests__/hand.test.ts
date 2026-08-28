import { describe, expect, it } from "vitest";
import { applyHand, biasAtShot, biasFrom, noiseAtShot, traitFrom } from "../hand.ts";

describe("身份偏差（跨局肌肉记忆的地基）", () => {
  it("同 (seed, agent) 永远同 bias（跨局稳定）", () => {
    for (let k = 0; k < 5; k++) {
      expect(biasFrom(42, "claude")).toBe(biasFrom(42, "claude"));
    }
  });
  it("不同 agent/seed 的 bias 不同且方向随机、量级在 ±[0.05,0.2]", () => {
    const seen = new Set<number>();
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const b = biasFrom(42, name);
      expect(Math.abs(b)).toBeGreaterThanOrEqual(0.05);
      expect(Math.abs(b)).toBeLessThanOrEqual(0.2);
      seen.add(Math.sign(b));
    }
    expect(seen.size).toBe(2); // 左右手都出现
    expect(biasFrom(42, "claude")).not.toBe(biasFrom(43, "claude"));
  });
});

describe("OU 漂移（闭式量）", () => {
  it("index=0 时严格等于 biasBase（零漂移）", () => {
    const hand = { ...traitFrom(7, "x", 0), biasBase: 1.3 };
    expect(biasAtShot(hand, 0, 42, "x")).toBeCloseTo(1.3, 12);
  });

  it("漂移量级有界（20 杆内偏离 biasBase 通常 < 0.5°）", () => {
    const hand = { ...traitFrom(42, "y", 0), biasBase: 1.0 };
    for (let i = 1; i <= 20; i++) {
      const b = biasAtShot(hand, i, 42, "y");
      expect(Math.abs(b - 1.0)).toBeLessThan(0.8);
    }
  });

  it("同 seed 同名同 trial 永远同 bias；不同 seed 漂移不同", () => {
    const hand = { ...traitFrom(17, "z", 3), biasBase: -1.2 };
    const a = biasAtShot(hand, 9, 17, "z");
    expect(biasAtShot(hand, 9, 17, "z")).toBe(a);
    expect(biasAtShot(hand, 9, 43, "z")).not.toBe(a);
  });
});

describe("噪声注入", () => {
  it("σ→0 时 actual = intent + bias", () => {
    const hand = {
      angleSigma: 0,
      powerSigma: 0,
      driftKappa: 0.02,
      driftSigma: 0,
      biasBase: 1.5,
    };
    const noise = noiseAtShot(hand, 0, 42, "k");
    const actual = applyHand({ angle: 30, power: 0.5 }, noise);
    expect(actual.angle).toBeCloseTo(31.5, 9);
    expect(actual.power).toBeCloseTo(0.5, 12);
  });

  it("power 夹到 [0,1]", () => {
    const hand = { angleSigma: 0, powerSigma: 10, driftKappa: 0, driftSigma: 0, biasBase: 0 };
    const actual = applyHand({ angle: 0, power: 2 }, noiseAtShot(hand, 0, 1, "x"));
    expect(actual.power).toBeLessThanOrEqual(1);
    expect(actual.power).toBeGreaterThanOrEqual(0);
  });

  it("噪声对可独立重算（流设计）", () => {
    const t = traitFrom(5, "w", 2);
    const n1 = noiseAtShot(t, 7, 5, "w");
    const n2 = noiseAtShot(t, 7, 5, "w");
    expect(n1).toEqual(n2);
  });
});
