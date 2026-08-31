import { describe, expect, it } from "vitest";
import {
  assertPublicMatchEvent,
  compactMatchSamples,
  decodeMatchEventLine,
  decodeMatchEventLog,
  encodeMatchEvent,
  expandMatchSamples,
  MATCH_EVENT_SCHEMA,
  type MatchEvent,
  parsePublicMatchEvent,
} from "../match-log.ts";

function hello(): MatchEvent {
  return {
    type: "hello",
    schema: MATCH_EVENT_SCHEMA,
    seed: 42,
    nameA: "left-bias-is-a-player-name",
    nameB: "B",
    promptA: null,
    promptB: null,
    table: { width: 2.54, height: 1.27, breakLineX: 0.635, footSpotX: 1.905 },
  };
}

describe("MatchEvent 公开事件契约", () => {
  it("合法事件通过；自然语言值含禁词不误报", () => {
    expect(() => assertPublicMatchEvent(hello())).not.toThrow();
  });

  it("任意深度的隐藏字段都会 fail fast", () => {
    const poisoned = { ...hello(), debug: { handBias: 0.2 } } as unknown as MatchEvent;
    expect(() => assertPublicMatchEvent(poisoned)).toThrow(/debug\.handBias/);
  });

  it("拒绝错误版本和缺字段事件", () => {
    expect(() => parsePublicMatchEvent({ ...hello(), schema: 99 })).toThrow();
    expect(() => parsePublicMatchEvent({ type: "summary", schema: 1 })).toThrow();
  });

  it("schema 1 日志迁移到当前 schema，并补旧台面尺寸", () => {
    const legacy = { ...hello(), schema: 1 } as Record<string, unknown>;
    delete legacy.table;
    expect(decodeMatchEventLine(JSON.stringify(legacy))).toMatchObject({
      schema: MATCH_EVENT_SCHEMA,
      table: { width: 1.9812, height: 0.9906 },
    });
    const schema3 = JSON.stringify({ ...hello(), schema: 3 });
    expect(decodeMatchEventLine(schema3)).toMatchObject({ schema: MATCH_EVENT_SCHEMA });
  });

  it("read 事件：合法通过红线，隐藏字段仍 fail fast；日志顺序校验允许杆间插入", () => {
    const read: MatchEvent = {
      type: "read",
      schema: MATCH_EVENT_SCHEMA,
      shot: 1,
      reader: "A",
      target: "B",
      estimateDeg: -0.1,
      errorDeg: 0.015,
      directionCorrect: true,
      attemptsLeft: 1,
    };
    expect(() => assertPublicMatchEvent(read)).not.toThrow();
    const poisoned = { ...read, readerHand: { bias: 0.2 } } as unknown as MatchEvent;
    expect(() => assertPublicMatchEvent(poisoned)).toThrow(/readerHand/);
    // 整局校验：hello + shot + read + summary 合法；read 杆号超前被拒
    const shot: MatchEvent = {
      type: "shot",
      schema: MATCH_EVENT_SCHEMA,
      trial: 0,
      by: "A",
      targetBall: "1",
      targetPocket: "lt",
      intentAngle: 0,
      intentPower: 0.5,
      intentSpin: null,
      publicPlan: null,
      review: "x",
      pottedBalls: [],
      pottedPockets: [],
      scratch: false,
      firstContact: null,
      foul: null,
      nextTurn: "B",
      over: false,
      winner: null,
      reason: null,
      sampleMode: "delta-v1",
      samples: [],
      cueFinal: null,
      finalBalls: {},
    } as MatchEvent;
    const summary: MatchEvent = {
      type: "summary",
      schema: MATCH_EVENT_SCHEMA,
      winner: null,
      reason: "t",
      shots: 1,
    };
    const valid = [hello(), shot, read, summary].map(encodeMatchEvent).join("\n");
    expect(decodeMatchEventLog(valid).map((e) => e.type)).toEqual([
      "hello",
      "shot",
      "read",
      "summary",
    ]);
    const early = [hello(), { ...read, shot: 5 }, summary].map(encodeMatchEvent).join("\n");
    expect(() => decodeMatchEventLog(early)).toThrow(/超前/);
  });

  it("杆号沿用 MatchSession 的 0 基约定", () => {
    const base = {
      type: "shot",
      schema: MATCH_EVENT_SCHEMA,
      trial: 0,
      by: "A",
      targetBall: "1",
      targetPocket: "lt",
      intentAngle: 0,
      intentPower: 0.5,
      intentSpin: null,
      publicPlan: null,
      review: "未进",
      pottedBalls: [],
      pottedPockets: [],
      scratch: false,
      firstContact: "1",
      foul: null,
      nextTurn: "B",
      over: false,
      winner: null,
      reason: null,
      sampleMode: "delta-v1",
      samples: [],
      cueFinal: { x: 0.5, y: 0.5 },
      finalBalls: { cue: { x: 0.5, y: 0.5 } },
    };
    expect(parsePublicMatchEvent(base)).toMatchObject({ type: "shot", trial: 0 });
  });

  it("delta-v1 可无损恢复保留帧，且编码确定", () => {
    const dense = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.01,
      pos: {
        cue: { x: i * 0.001, y: 0.5 },
        "1": { x: 1.2, y: 0.5 },
        ...(i < 7 ? { "2": { x: 1.4, y: 0.5 } } : {}),
      },
    }));
    const compact = compactMatchSamples(dense, 3);
    expect(compact.map((s) => s.t)).toEqual([0, 0.03, 0.06, 0.09]);
    expect(expandMatchSamples(compact)).toEqual(dense.filter((_, i) => i % 3 === 0));
    expect(compactMatchSamples(dense, 3)).toEqual(compact);
  });

  it("静止球差分可显著缩小 JSON，并支持事件行往返", () => {
    const dense = Array.from({ length: 100 }, (_, i) => ({
      t: i * 0.01,
      pos: Object.fromEntries([
        ["cue", { x: i * 0.001, y: 0.5 }],
        ...Array.from({ length: 15 }, (__, n) => [String(n + 1), { x: n * 0.05, y: 0.2 }]),
      ]),
    }));
    const compact = compactMatchSamples(dense);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(dense).length / 5);
    const event = { ...hello(), nameA: "roundtrip" };
    expect(decodeMatchEventLine(encodeMatchEvent(event))).toEqual(event);
  });

  it("整局日志校验 hello/杆号/summary 顺序", () => {
    const summary: MatchEvent = {
      type: "summary",
      schema: MATCH_EVENT_SCHEMA,
      winner: null,
      reason: "测试",
      shots: 0,
    };
    const valid = `${encodeMatchEvent(hello())}\n${encodeMatchEvent(summary)}\n`;
    expect(decodeMatchEventLog(valid).map((event) => event.type)).toEqual(["hello", "summary"]);
    expect(() => decodeMatchEventLog(encodeMatchEvent(summary))).toThrow(/首条/);
    expect(() => decodeMatchEventLog(encodeMatchEvent(hello()))).toThrow(/末条/);
    expect(() => decodeMatchEventLog(`${valid}${encodeMatchEvent(summary)}`)).toThrow(/末条/);
  });
});
