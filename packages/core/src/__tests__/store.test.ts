import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ELO_INITIAL, eloDelta, Store } from "../store.ts";

describe("Store（node:sqlite 持久化）", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("loadBias 未知 agent → null；saveBias → roundtrip", () => {
    expect(store.loadBias("newbie")).toBeNull();
    store.saveBias("claude-4", 1.234);
    expect(store.loadBias("claude-4")).toBeCloseTo(1.234, 12);
    store.saveBias("claude-4", -0.8);
    expect(store.loadBias("claude-4")).toBeCloseTo(-0.8, 12);
  });

  it("sessions + shots + stats 全链", () => {
    const sid = store.startSession("gpt-9", "calibrate", 42);
    expect(sid).toBeGreaterThan(0);
    store.recordShot({
      sessionId: sid,
      trial: 0,
      intentAngle: 10,
      intentPower: 0.5,
      actualAngle: 2.7,
      actualPower: 0.51,
      optimal: 1.2,
      pot: true,
    });
    store.recordShot({
      sessionId: sid,
      trial: 1,
      intentAngle: 2,
      intentPower: 0.4,
      actualAngle: 3.1,
      actualPower: 0.49,
      optimal: 1.4,
      pot: false,
    });
    const st = store.stats("gpt-9");
    expect(st.sessions).toBe(1);
    expect(st.shots).toBe(2);
    expect(st.pots).toBe(1);
  });

  it("匿名内存库与文件库互不干扰（同 agent 不同 bias）", () => {
    store.saveBias("a", 1.0);
    const other = new Store();
    other.saveBias("a", -1.0);
    expect(store.loadBias("a")).toBeCloseTo(1.0, 6);
    expect(other.loadBias("a")).toBeCloseTo(-1.0, 6);
    other.close();
  });
});

describe("Elo 记分（M6.5）", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("eloDelta：同分对局胜 +K/2、负 -K/2、平 0", () => {
    expect(eloDelta(1500, 1500, 1)).toBeCloseTo(16, 10);
    expect(eloDelta(1500, 1500, 0)).toBeCloseTo(-16, 10);
    expect(eloDelta(1500, 1500, 0.5)).toBeCloseTo(0, 10);
  });

  it("eloDelta：强胜弱涨得少、弱胜强涨得多，且双向对称", () => {
    const small = eloDelta(1700, 1300, 1);
    const big = eloDelta(1300, 1700, 1);
    expect(small).toBeLessThan(16);
    expect(big).toBeGreaterThan(16);
    expect(big).toBeCloseTo(-eloDelta(1700, 1300, 0), 10);
  });

  it("recordMatchResult：胜负入账，榜单降序，总分守恒", () => {
    store.recordMatchResult("alice", "bob", "A", "合法打进 8 号——胜");
    const lb = store.leaderboard();
    expect(lb[0]).toMatchObject({ name: "alice", wins: 1, losses: 0, games: 1 });
    expect(lb[1]).toMatchObject({ name: "bob", wins: 0, losses: 1, games: 1 });
    expect(lb[0]!.rating).toBeGreaterThan(ELO_INITIAL);
    expect(lb[1]!.rating).toBeLessThan(ELO_INITIAL);
    expect(lb[0]!.rating + lb[1]!.rating).toBeCloseTo(2 * ELO_INITIAL, 8);
  });

  it("平局：双方各计一局平，总分守恒", () => {
    store.recordMatchResult("a", "b", null, "杆数预算耗尽——平局");
    const lb = store.leaderboard();
    expect(lb.every((e) => e.draws === 1 && e.games === 1)).toBe(true);
    expect(lb[0]!.rating + lb[1]!.rating).toBeCloseTo(2 * ELO_INITIAL, 8);
  });

  it("多局累积：高分者再胜涨得更少（期望分效应）", () => {
    store.recordMatchResult("alice", "bob", "A");
    const after1 = store.leaderboard().find((e) => e.name === "alice")!.rating;
    store.recordMatchResult("alice", "bob", "A");
    const after2 = store.leaderboard().find((e) => e.name === "alice")!.rating;
    expect(after2 - after1).toBeLessThan(after1 - ELO_INITIAL);
    expect(store.leaderboard().find((e) => e.name === "alice")!.games).toBe(2);
  });
});
