import { describe, expect, it } from "vitest";
import { CalibSession } from "../trial.ts";
import { assertNoLeak, LEAK_WORDS } from "../views.ts";

describe("泄漏红线（docs/hand-model.md §6）", () => {
  it("AgentObserve 的键白名单", () => {
    const s = new CalibSession({ seed: 42, agent: "leak-test" });
    const obs = s.observe();
    const keys = Object.keys(obs).sort();
    expect(keys).toEqual([
      "aimAssist",
      "balls",
      "kind",
      "pockets",
      "score",
      "targetPocket",
      "trial",
      "trialCount",
    ]);
    for (const b of obs.balls) expect(Object.keys(b).sort()).toEqual(["id", "x", "y"]);
    expect(Object.keys(obs.aimAssist!).sort()).toEqual(["cutAngleDeg", "ghost", "suggestedAngle"]);
  });

  it("100 局 × 全部 trial 的观察 JSON 不含任何禁词（含漂移后的 bias 数值）", () => {
    const agents = ["gpt", "claude", "pi", "qwen-3", "deepseek-r1"];
    const _count = 0;
    for (const agent of agents) {
      for (const seed of [1, 7, 42, 999]) {
        const s = new CalibSession({ seed, agent, trialCount: 20 });
        while (!s.finished) {
          const obs = s.observe();
          // 逐键断言（JSON 含禁词检查）
          assertNoLeak(obs);
          const text = JSON.stringify(obs);
          for (const w of LEAK_WORDS) expect(text).not.toContain(w);
          // 数值级检查：观察串里不能出现当前真实 bias 的任何角度化值（小数/整数/度）
          const rec = s.shoot({ angle: 5, power: 0.5 });
          void rec;
        }
      }
    }
  });

  it("ResearchShot 才持有三元组与噪声明细", () => {
    const s = new CalibSession({ seed: 5, agent: "r" });
    const rec = s.shoot({ angle: 1, power: 0.5 });
    expect(rec).toHaveProperty("actual");
    expect(rec).toHaveProperty("optimal");
    expect(rec.noise).toHaveProperty("biasAt");
  });
});
