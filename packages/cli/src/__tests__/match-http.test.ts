/**
 * 外部选手入座层测试（M6.3）：回合门控 / 入座校验 / 出杆等待与超时
 */
import { MatchSession } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import { MatchHttp } from "../match-http.ts";

function mk(): { http: MatchHttp; session: MatchSession } {
  const http = new MatchHttp({ nameA: "alice", nameB: "bob", shotClockMs: 0 });
  const session = new MatchSession({ seed: 42, nameA: "alice", nameB: "bob", maxShots: 30 });
  http.attach(session);
  return { http, session };
}

describe("MatchHttp 入座与门控", () => {
  it("身份名认领桌位，不符返回 404", () => {
    const { http } = mk();
    expect(http.seatOf("alice")).toBe("A");
    expect(http.seatOf("bob")).toBe("B");
    expect(http.seatOf("carol")).toBeNull();
    const join = http.route("POST", "/match/join", { name: "carol" });
    expect(join.status).toBe(404);
    const ok = http.route("POST", "/match/join", { name: "alice" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ seat: "A" });
  });

  it("未开局时 state/observe 返回 503", () => {
    const http = new MatchHttp({ nameA: "a", nameB: "b", shotClockMs: 0 });
    expect(http.route("GET", "/match/state", null).status).toBe(503);
    expect(http.route("GET", "/match/observe?name=a", null).status).toBe(503);
  });

  it("state：透出轮次/比分/等待对象（不含隐藏手感字段）", () => {
    const { http } = mk();
    const r = http.route("GET", "/match/state", null);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ turn: "A", shot: 0, over: false, waitingFor: null });
    expect(JSON.stringify(r.body)).not.toMatch(/bias|actual|hand/i);
  });

  it("observe 回合门控：没轮到你 → 409 + 当前轮次", () => {
    const { http } = mk();
    const wrong = http.route("GET", "/match/observe?name=bob", null);
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ turn: "A" });
    const right = http.route("GET", "/match/observe?name=alice", null);
    expect(right.status).toBe(200);
    expect(right.body).toMatchObject({ kind: "match-observe", you: "A" });
  });

  it("shot 回合门控：没轮到你 → 409；出杆载荷非法 → 400", () => {
    const { http } = mk();
    const wrongTurn = http.route("POST", "/match/shot", {
      name: "bob",
      aimX: 1,
      aimY: 0.5,
      power: 0.5,
      targetBall: "1",
      targetPocket: "rt",
    });
    expect(wrongTurn.status).toBe(409);
    const bad = http.route("POST", "/match/shot", { name: "alice", power: 2 });
    expect(bad.status).toBe(400);
  });

  it("waitForShot：轮到该选手的合法出杆被受理并唤醒循环", async () => {
    const { http } = mk();
    const waiting = http.waitForShot("A");
    const res = http.route("POST", "/match/shot", {
      name: "alice",
      aimX: 1,
      aimY: 0.5,
      power: 0.5,
      targetBall: "1",
      targetPocket: "rt",
      prediction: "直球轻推",
    });
    expect(res.status).toBe(202);
    const wait = await waiting;
    expect(wait.kind).toBe("shot");
    if (wait.kind === "shot") expect(wait.shot.prediction).toBe("直球轻推");
    // 等待已清空：再来一杆应 409
    expect(
      http.route("POST", "/match/shot", {
        name: "alice",
        aimX: 1,
        aimY: 0.5,
        power: 0.5,
        targetBall: "1",
        targetPocket: "rt",
      }).status,
    ).toBe(409);
  });

  it("出杆限时：超时后等待以 timeout 结局", async () => {
    const http = new MatchHttp({ nameA: "a", nameB: "b", shotClockMs: 30 });
    http.attach(new MatchSession({ seed: 42, nameA: "a", nameB: "b" }));
    const wait = await http.waitForShot("A");
    expect(wait.kind).toBe("timeout");
  });

  it("AbortSignal 打断等待（进程退出路径）", async () => {
    const { http } = mk();
    const ac = new AbortController();
    const waiting = http.waitForShot("A", ac.signal);
    ac.abort();
    expect((await waiting).kind).toBe("timeout");
  });
});
