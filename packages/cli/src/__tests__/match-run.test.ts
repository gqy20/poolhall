import type { MatchEvent, MatchObserve } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import type { ShotWait } from "../match-http.ts";
import { runMatch } from "../match-run.ts";

describe("实时对局公开叙事", () => {
  it("synthetic 选手同样产出公开计划与服务端复盘", async () => {
    const events: MatchEvent[] = [];
    await runMatch({
      specA: "synthetic:oracle",
      specB: "synthetic:oracle",
      nameA: "A",
      nameB: "B",
      seed: 42,
      maxShots: 1,
      out: "/dev/null",
      hub: { broadcast: (event) => events.push(event) },
    });
    const shot = events.find((event) => event.type === "shot");
    expect(shot?.publicPlan).toMatchObject({ confidence: "high" });
    expect(shot?.review.length).toBeGreaterThan(0);
  });
});

/** 外部选手驱动（测试用）：oracle 同款选球——最小切角组合，瞄 ghost */
function externalOracle(obs: MatchObserve): ShotWait {
  const best = obs.aimAssists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
  return {
    kind: "shot",
    shot: {
      name: "",
      aimX: best.ghost.x,
      aimY: best.ghost.y,
      power: obs.breakShot ? 0.85 : 0.6,
      targetBall: best.ball,
      targetPocket: best.pocket,
      prediction: `计划打进 ${best.ball} 号球`,
    },
  };
}

describe("外部选手接入（M6.3）", () => {
  it("双 external 完整对局：回合门控下正常终局，公开计划走预测文本", async () => {
    const events: MatchEvent[] = [];
    const turns: string[] = [];
    const r = await runMatch({
      specA: "external",
      specB: "external",
      nameA: "extA",
      nameB: "extB",
      seed: 42,
      maxShots: 60,
      out: "/dev/null",
      hub: { broadcast: (event) => events.push(event) },
      externalShot: async (player, obs) => {
        turns.push(player);
        return externalOracle(obs);
      },
    });
    expect(r.shots).toBeGreaterThan(0);
    expect(turns.length).toBe(r.shots);
    const shot = events.find((event) => event.type === "shot");
    expect(shot?.publicPlan).toMatchObject({ confidence: "medium" });
    expect(shot?.publicPlan?.observation).toContain("计划打进");
  });

  it("出杆超时：未被打断时认负，对手获胜", async () => {
    const r = await runMatch({
      specA: "external",
      specB: "synthetic:oracle",
      nameA: "慢手",
      nameB: "快手",
      seed: 42,
      maxShots: 30,
      out: "/dev/null",
      externalShot: async () => ({ kind: "timeout" }),
    });
    expect(r.winner).toBe("B");
    expect(r.reason).toContain("出杆超时");
  });

  it("进程被打断（shouldStop）时超时不判负", async () => {
    // 第一次检查（循环门）放行，第二次检查（超时判负前）拦截——模拟 Ctrl-C 发生在等待期间
    let checks = 0;
    const r = await runMatch({
      specA: "external",
      specB: "synthetic:oracle",
      nameA: "A",
      nameB: "B",
      seed: 42,
      maxShots: 30,
      out: "/dev/null",
      shouldStop: () => ++checks > 1,
      externalShot: async () => ({ kind: "timeout" }),
    });
    expect(r.winner).toBeNull();
    expect(r.reason).toBeNull();
  });
});
