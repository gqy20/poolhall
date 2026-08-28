import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeBall, strike } from "../ball.ts";
import { DEFAULT_BALL } from "../consts.ts";
import { serializeTrajectory, simulate } from "../simulate.ts";
import { buildTable } from "../table.ts";
import { len, vec2 } from "../vec2.ts";

const table = buildTable();
const p = DEFAULT_BALL;

const arbAngle = fc.integer({ min: -180, max: 180 });
const arbPower = fc.double({ min: 0, max: 1, noNaN: true });
const arbPos = fc
  .integer({ min: 10, max: 90 })
  .chain((ax) =>
    fc
      .integer({ min: 10, max: 90 })
      .map((ay) => ({ x: (ax / 100) * table.width, y: (ay / 100) * table.height })),
  );

describe("性质测试：任意一杆", () => {
  it("必然停球或进袋（watchdog 内正常终止）", { timeout: 120000 }, () => {
    fc.assert(
      fc.property(arbAngle, arbPower, arbPos, (ang, pw, pos) => {
        const cue = makeBall("cue", pos);
        strike(cue, ang, pw);
        const r = simulate([cue], table, p, { watchdog: 60 });
        expect(r.stopReason).toBe("stopped");
        const final = r.balls[0]!;
        return final.pocketed || len(final.vel) === 0;
      }),
      { numRuns: 60 },
    );
  });

  it("终态动能 ≤ 初态动能；未进袋球都在台面范围", { timeout: 120000 }, () => {
    fc.assert(
      fc.property(arbAngle, arbPower, arbPos, (ang, pw, pos) => {
        const cue = makeBall("cue", pos);
        strike(cue, ang, pw);
        const v0 = len(cue.vel);
        const r = simulate([cue], table, p, { watchdog: 60 });
        const final = r.balls[0]!;
        const vf = len(final.vel);
        const inBounds =
          final.pocketed ||
          (final.pos.x >= -1e-6 &&
            final.pos.x <= table.width + 1e-6 &&
            final.pos.y >= -1e-6 &&
            final.pos.y <= table.height + 1e-6);
        return vf <= v0 + 1e-9 && inBounds;
      }),
      { numRuns: 60 },
    );
  });

  it("两球任意开局：终态不重叠（或一方进袋）", { timeout: 180000 }, () => {
    fc.assert(
      fc.property(arbAngle, arbPower, arbPos, arbPos, (ang, pw, p1, p2) => {
        const a = makeBall("a", p1);
        const b = makeBall("b", p2);
        // 初始重叠/贴袋的布局无意义，跳过
        if (len(vec2(p1.x - p2.x, p1.y - p2.y)) < 3 * p.R) return true;
        strike(a, ang, pw);
        const r = simulate([a, b], table, p, { watchdog: 60 });
        const A = r.balls.find((x) => x.id === "a")!;
        const B = r.balls.find((x) => x.id === "b")!;
        if (A.pocketed || B.pocketed) return true;
        const d = len(vec2(A.pos.x - B.pos.x, A.pos.y - B.pos.y));
        return d >= 2 * p.R - 1e-6;
      }),
      { numRuns: 60 },
    );
  });

  it("确定性：任意输入两次模拟轨迹哈希原料一致", { timeout: 120000 }, () => {
    fc.assert(
      fc.property(arbAngle, arbPower, arbPos, arbPos, (ang, pw, p1, p2) => {
        const mk = () => {
          const cue = makeBall("cue", p1);
          const obj = makeBall("1", p2);
          if (len(vec2(p1.x - p2.x, p1.y - p2.y)) < 3 * p.R) return null;
          strike(cue, ang, pw);
          return [cue, obj];
        };
        const s1 = mk();
        const s2 = mk();
        if (!s1 || !s2) return true;
        return (
          serializeTrajectory(simulate(s1, table, p)) ===
          serializeTrajectory(simulate(s2, table, p))
        );
      }),
      { numRuns: 40 },
    );
  });
});
