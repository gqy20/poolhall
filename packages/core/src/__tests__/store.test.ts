import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store.ts";

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
