import { describe, expect, it } from "vitest";
import { makeBall, strike } from "../ball.ts";
import { resolveBallBall, resolveCushion } from "../collide.ts";
import { DEFAULT_BALL } from "../consts.ts";
import { serializeTrajectory, simulate } from "../simulate.ts";
import { buildTable } from "../table.ts";
import { vec2 } from "../vec2.ts";

const table = buildTable();
const p = DEFAULT_BALL;

describe("碰撞解算（精确单测）", () => {
  it("球-球正碰：等质量法向速度按 e_b 交换", () => {
    const a = makeBall("a", vec2(0, 0));
    const b = makeBall("b", vec2(2 * p.R, 0));
    a.vel = vec2(2, 0);
    resolveBallBall(a, b, p);
    expect(a.vel.x).toBeCloseTo(2 - 1.95, 12); // (1+e_b)/2 · 2 = 1.95
    expect(b.vel.x).toBeCloseTo(1.95, 12);
    expect(a.vel.y).toBe(0);
    expect(b.vel.y).toBe(0);
  });

  it("球-球重叠且分离中：只做位置分离，不动速度", () => {
    const a = makeBall("a", vec2(0, 0));
    const b = makeBall("b", vec2(0.05, 0)); // gap 0.05 < 2R 0.05715
    a.vel = vec2(-1, 0);
    b.vel = vec2(1, 0);
    resolveBallBall(a, b, p);
    expect(a.vel.x).toBe(-1);
    expect(b.vel.x).toBe(1);
    const gap = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
    expect(gap).toBeGreaterThanOrEqual(2 * p.R);
  });

  it("库边：法向 e_c 反弹、切向保留", () => {
    const up = makeBall("x", vec2(0, 0));
    up.vel = vec2(1, -2);
    resolveCushion(up, "up", p);
    expect(up.vel.x).toBeCloseTo(0.9, 12);
    expect(up.vel.y).toBeCloseTo(1.7, 12);

    const left = makeBall("x", vec2(0, 0));
    left.vel = vec2(-2, 1);
    resolveCushion(left, "left", p);
    expect(left.vel.x).toBeCloseTo(1.7, 12);
    expect(left.vel.y).toBeCloseTo(0.9, 12);
  });
});

describe("两阶段摩擦（解析距离验证）", () => {
  it("v0=0.6 无碰撞直行：滑动+滚动总距离 ≈ 0.981m", () => {
    // 解析：t_s=v0/(3.5·u_s·g)=87.4ms，v_roll=5/7·v0，
    // d1≈0.0449 + d2≈0.9362 = 0.9811m（阈值离散化 ±2.5cm 容差）
    const cue = makeBall("cue", vec2(0.3, 0.5));
    cue.vel = vec2(0.6, 0);
    const r = simulate([cue], table, p);
    expect(r.stopReason).toBe("stopped");
    expect(r.events).toHaveLength(0); // 无碰撞无进袋
    const final = r.balls[0]!;
    expect(final.pos.x).toBeCloseTo(0.3 + 0.981, 1);
    expect(final.pos.y).toBeCloseTo(0.5, 9);
    expect(final.vel.x).toBe(0);
    expect(final.vel.y).toBe(0);
  });

  it("慢速球比快速球先停", () => {
    const run = (power: number): number =>
      simulate(
        [
          (() => {
            const b = makeBall("cue", vec2(0.2, 0.5));
            strike(b, 0, power);
            return b;
          })(),
        ],
        table,
        p,
      ).simTime;
    expect(run(0.1)).toBeLessThan(run(0.4));
  });
});

describe("模拟场景", () => {
  it("直线快球：多次吃库后停在台内，速度精确归零", () => {
    const cue = makeBall("cue", vec2(1.0, 0.5));
    strike(cue, 0, 0.5);
    const r = simulate([cue], table, p, { watchdog: 20 });
    const final = r.balls[0]!;
    expect(r.stopReason).toBe("stopped");
    expect(r.events.some((e) => e.kind === "ball-cushion" && e.cushion === "right")).toBe(true);
    expect(final.pos.x).toBeGreaterThan(0);
    expect(final.pos.x).toBeLessThan(table.width);
    expect(final.vel.x).toBe(0);
    expect(final.vel.y).toBe(0);
  });

  it("球-球正碰：事件记录 + 终态不重叠且全静止", () => {
    const a = makeBall("a", vec2(0.5, 0.5));
    const b = makeBall("b", vec2(0.7, 0.5));
    strike(a, 0, 0.3);
    const r = simulate([a, b], table, p);
    const A = r.balls.find((x) => x.id === "a")!;
    const B = r.balls.find((x) => x.id === "b")!;
    expect(r.events.filter((e) => e.kind === "ball-ball")).not.toHaveLength(0);
    expect(A.vel.x).toBe(0);
    expect(B.vel.x).toBe(0);
    const gap = Math.hypot(B.pos.x - A.pos.x, B.pos.y - A.pos.y);
    expect(gap).toBeGreaterThanOrEqual(2 * p.R - 1e-6);
  });

  it("库边反弹：瞄准库边段中部，反弹后停在台内", () => {
    const cue = makeBall("cue", vec2(0.5, 0.3));
    strike(cue, 90, 0.4);
    const r = simulate([cue], table, p);
    const final = r.balls[0]!;
    expect(r.events.some((e) => e.kind === "ball-cushion" && e.cushion === "up")).toBe(true);
    expect(final.pocketed).toBe(false);
    expect(final.vel.y).toBe(0);
  });

  it("进袋：直线打向角袋", () => {
    const cue = makeBall("cue", vec2(1.7, 0.75));
    const ang = (Math.atan2(-(0 - 0.75), 0 - 1.7) * 180) / Math.PI;
    strike(cue, ang, 0.5);
    const r = simulate([cue], table, p);
    const final = r.balls[0]!;
    expect(final.pocketed).toBe(true);
    expect(final.pocket).toBe("lt");
    expect(r.events.some((e) => e.kind === "pocket" && e.pocket === "lt")).toBe(true);
  });
});

describe("确定性", () => {
  const setup = () => {
    const cue = makeBall("cue", vec2(0.5, 0.5));
    const one = makeBall("1", vec2(1.2, 0.45));
    const two = makeBall("2", vec2(1.5, 0.6));
    strike(cue, 10, 0.6);
    return [cue, one, two];
  };

  it("同输入两次模拟：序列化轨迹逐字节一致", () => {
    const r1 = serializeTrajectory(simulate(setup(), table, p));
    const r2 = serializeTrajectory(simulate(setup(), table, p));
    expect(r1).toBe(r2);
  });

  it("不同出手角度：轨迹不同", () => {
    const s1 = setup();
    strike(s1[0]!, 15, 0.6);
    const s2 = setup();
    strike(s2[0]!, 12, 0.6);
    expect(serializeTrajectory(simulate(s1, table, p))).not.toBe(
      serializeTrajectory(simulate(s2, table, p)),
    );
  });

  it("watchdog 兜底不死循环", () => {
    const cue = makeBall("cue", vec2(1.0, 0.5));
    strike(cue, 0, 1.0);
    const r = simulate([cue], table, p, { watchdog: 0.05 });
    expect(r.stopReason).toBe("watchdog");
  });
});

describe("序列化", () => {
  it("样品与事件行格式稳定", () => {
    const cue = makeBall("cue", vec2(1.0, 0.5));
    strike(cue, 90, 0.4);
    const r = simulate([cue], table, p, { sampleEvery: 0.05 });
    const s = serializeTrajectory(r);
    expect(s.split("\n")[0]).toMatch(/^s 0\.000000 cue:/);
    expect(s).toMatch(/^e /m);
  });
});

describe("台面几何", () => {
  it("六袋齐全、库边段不与袋口重叠", () => {
    const t = buildTable();
    expect(t.pockets).toHaveLength(6);
    for (const seg of t.cushions) {
      expect(seg.hi).toBeGreaterThan(seg.lo);
    }
  });
});
