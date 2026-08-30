import type { MatchEvent } from "@poolhall/core";
import { describe, expect, it } from "vitest";
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
