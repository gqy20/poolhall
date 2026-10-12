/**
 * 外部选手入座层测试（M6.3）：回合门控 / 入座校验 / 出杆等待与超时
 */
import { MatchSession, Store } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import { attachLastShot, MatchHttp, READ_MAX } from "../match-http.ts";

function mk(): { http: MatchHttp; session: MatchSession } {
  const http = new MatchHttp({ fixed: { A: "alice", B: "bob" }, shotClockMs: 0 });
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
    const http = new MatchHttp({ fixed: { A: "a", B: "b" }, shotClockMs: 0 });
    expect(http.route("GET", "/match/state", null).status).toBe(503);
    expect(http.route("GET", "/match/observe?name=a", null).status).toBe(503);
  });

  it("state：透出 shotDeadlineMs（限时截止时刻；无挂起/不限时为 null）", () => {
    const { http } = mk();
    expect(http.route("GET", "/match/state", null).body).toMatchObject({ shotDeadlineMs: null });
    const timed = new MatchHttp({ fixed: { A: "a", B: "b" }, shotClockMs: 60000 });
    timed.attach(new MatchSession({ seed: 42, nameA: "a", nameB: "b" }));
    timed.waitForShot("A");
    const body = timed.route("GET", "/match/state", null).body as { shotDeadlineMs: number };
    expect(body.shotDeadlineMs).toBeGreaterThan(Date.now());
    expect(body.shotDeadlineMs).toBeLessThan(Date.now() + 100000);
  });

  it("state：透出轮次/比分/等待对象（不含隐藏手感字段）", () => {
    const { http } = mk();
    const r = http.route("GET", "/match/state", null);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ turn: "A", shot: 0, over: false, waitingFor: null });
    expect(JSON.stringify(r.body)).not.toMatch(/bias|actual|hand/i);
  });

  it("recentShots：lastShot 不被对手下一杆覆盖（反馈不丢）", () => {
    const { http } = mk();
    http.lastShot = { shot: 0, by: "A" };
    http.lastShot = { shot: 1, by: "B" };
    const r = http.route("GET", "/match/state", null);
    const body = r.body as { recentShots: Array<{ by: string }>; lastShot: { by: string } };
    expect(body.recentShots.map((s) => s.by)).toEqual(["A", "B"]);
    expect(body.lastShot.by).toBe("B");
  });

  it("state：透出 lastShot（最近一杆公开事实，反馈回路原料）", () => {
    const { http } = mk();
    http.lastShot = { shot: 0, by: "A", pottedBalls: ["3"] };
    const r = http.route("GET", "/match/state", null);
    expect(r.body).toMatchObject({ lastShot: { shot: 0, by: "A" } });
  });

  it("attachLastShot：shot 事件记入 lastShot（去轨迹），reset 清空", () => {
    const http = new MatchHttp({ fixed: { A: "a", B: "b" }, shotClockMs: 0 });
    const seen: unknown[] = [];
    const sink = attachLastShot({ broadcast: (event) => seen.push(event), reset: () => {} }, http);
    sink.broadcast({
      type: "shot",
      schema: 3,
      trial: 0,
      by: "A",
      samples: [{ t: 0, pos: {} }],
    } as never);
    expect(http.lastShot).toMatchObject({ trial: 0, by: "A" });
    expect(http.lastShot).not.toHaveProperty("samples");
    expect(seen).toHaveLength(1);
    sink.reset();
    expect(http.lastShot).toBeNull();
  });

  it("固定席位模式：非预绑定身份 join 被拒（404）", () => {
    const { http } = mk();
    const join = http.route("POST", "/match/join", { name: "carol" });
    expect(join.status).toBe(404);
    expect(http.seatOf("carol")).toBeNull();
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
      clean: true,
    });
    expect(res.status).toBe(202);
    const wait = await waiting;
    expect(wait.kind).toBe("shot");
    if (wait.kind === "shot") {
      expect(wait.shot.prediction).toBe("直球轻推");
      expect(wait.shot.clean).toBe(true);
    }
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
    const http = new MatchHttp({ fixed: { A: "a", B: "b" }, shotClockMs: 30 });
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
  it("presetSeat：预占座外部 agent 不可抢（混编规格防抢座）", () => {
    const http = new MatchHttp({ shotClockMs: 0 });
    http.presetSeat("A", "t1-a");
    expect(http.claim("alice")).toEqual({ ok: true, seat: "B" });
    expect(http.claim("bob").ok).toBe(false);
  });
});

describe("MatchHttp 动态认座（大厅模式）", () => {
  function mkDynamic(): MatchHttp {
    return new MatchHttp({ shotClockMs: 0 });
  }

  it("先认 A 后认 B；重复 join 幂等返回原席位", () => {
    const http = mkDynamic();
    expect(http.claim("alice")).toEqual({ ok: true, seat: "A" });
    expect(http.claim("bob")).toEqual({ ok: true, seat: "B" });
    expect(http.claim("alice")).toEqual({ ok: true, seat: "A" });
  });

  it("满员后认座 409；leave 后空位可再认", () => {
    const http = mkDynamic();
    http.claim("alice");
    http.claim("bob");
    const full = http.claim("carol");
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.status).toBe(409);
    expect(http.leave("bob")).toBe(true);
    expect(http.claim("carol")).toEqual({ ok: true, seat: "B" });
  });

  it("onClaim 监听在认座时触发（大厅凑齐开局钩子）", () => {
    const http = mkDynamic();
    const seen: Array<[string, string]> = [];
    http.onClaim((seat, name) => seen.push([seat, name]));
    http.claim("alice");
    expect(seen).toEqual([["A", "alice"]]);
  });

  it("leave 路由：未认座者 404", () => {
    const http = mkDynamic();
    expect(http.route("POST", "/match/leave", { name: "nobody" }).status).toBe(404);
  });
});

describe("MatchHttp 离席（/match/leave）", () => {
  it("未认座 404；对局进行中离席 = 判负终局并结算挂起的出杆等待", async () => {
    const { http, session } = mk();
    expect(http.route("POST", "/match/leave", { name: "nobody" }).status).toBe(404);
    // 挂起 A 的出杆等待（模拟对局循环在等外部选手）
    const waiting = http.waitForShot("A");
    const r = http.route("POST", "/match/leave", { name: "alice" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, resigned: true });
    // 对局立即终局：B 胜（alice 判负），挂起的等待按超时结算
    expect(session.finished).toBe(true);
    expect(session.result.winner).toBe("B");
    expect(session.result.reason).toContain("离席");
    expect((await waiting).kind).toBe("timeout");
  });

  it("对局已结束时离席走正常释放（大厅动态席位）", () => {
    const http = new MatchHttp({ shotClockMs: 0 });
    http.claim("alice");
    expect(http.route("POST", "/match/leave", { name: "alice" }).status).toBe(200);
    expect(http.seatOf("alice")).toBeNull();
  });
});

describe("MatchHttp 试打预演（/match/preview）", () => {
  it("未开局 503；身份不符 404；载荷非法 400", () => {
    const bare = new MatchHttp({ shotClockMs: 0 });
    expect(bare.route("POST", "/match/preview", { name: "x", angle: 0, power: 0.5 }).status).toBe(
      503,
    );
    const { http } = mk();
    expect(
      http.route("POST", "/match/preview", { name: "carol", angle: 0, power: 0.5 }).status,
    ).toBe(404);
    expect(http.route("POST", "/match/preview", { name: "alice", angle: 0, power: 2 }).status).toBe(
      400,
    );
  });

  it("已认座即可预演（不要求轮到本人）：返回纯物理轨迹", () => {
    const { http } = mk();
    const r = http.route("POST", "/match/preview", { name: "bob", angle: 30, power: 0.6 });
    expect(r.status).toBe(200);
    const body = r.body as {
      ok: boolean;
      seat: string;
      preview: { paths: Record<string, unknown> };
    };
    expect(body.ok).toBe(true);
    expect(body.seat).toBe("B");
    expect(body.preview.paths.cue).toBeDefined();
  });

  it("预演不改局面且不泄漏隐藏手感字段", () => {
    const { http, session } = mk();
    const before = JSON.stringify(session.observe());
    http.route("POST", "/match/preview", { name: "alice", angle: 5, power: 0.5 });
    expect(JSON.stringify(session.observe())).toBe(before);
    const r = http.route("POST", "/match/preview", { name: "alice", angle: 5, power: 0.5 });
    expect(JSON.stringify(r.body)).not.toMatch(/bias|sigma|noise|hand|drift/i);
  });
});

describe("MatchHttp 读对手（/match/read）", () => {
  function mkRead(): { http: MatchHttp; session: MatchSession; store: Store } {
    const store = new Store(":memory:");
    const http = new MatchHttp({ shotClockMs: 0, store, fixed: { A: "alice", B: "bob" } });
    const session = new MatchSession({ seed: 42, nameA: "alice", nameB: "bob", maxShots: 30 });
    http.attach(session);
    return { http, session, store };
  }

  it("未开局 503；身份不符 404；载荷非法 400", () => {
    const bare = new MatchHttp({ shotClockMs: 0 });
    expect(bare.route("POST", "/match/read", { name: "x", estimateDeg: 0.1 }).status).toBe(503);
    const { http } = mkRead();
    expect(http.route("POST", "/match/read", { name: "carol", estimateDeg: 0.1 }).status).toBe(404);
    expect(http.route("POST", "/match/read", { name: "alice", estimateDeg: 99 }).status).toBe(400);
  });

  it("评分：猜中方向与量级时误差小、方向对；返回值不泄漏真实 bias", () => {
    const { http, session } = mkRead();
    const trueBias = session.handB.biasBase; // alice 读 bob（B）
    const r = http.route("POST", "/match/read", { name: "alice", estimateDeg: trueBias });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toMatchObject({ target: "B", directionCorrect: true, attemptsLeft: READ_MAX - 1 });
    expect(body.errorDeg as number).toBeLessThan(0.021);
    expect(JSON.stringify(body)).not.toMatch(/bias/i);
  });

  it("限次：READ_MAX 后 409；attach（新局）重置", () => {
    const { http, session } = mkRead();
    for (let i = 0; i < READ_MAX; i++) {
      expect(http.route("POST", "/match/read", { name: "alice", estimateDeg: 0.1 }).status).toBe(
        200,
      );
    }
    const capped = http.route("POST", "/match/read", { name: "alice", estimateDeg: 0.1 });
    expect(capped.status).toBe(409);
    expect(capped.body).toMatchObject({ attemptsLeft: 0 });
    http.attach(session); // 新局重置限次（同 session 仅测试用）
    expect(http.route("POST", "/match/read", { name: "alice", estimateDeg: 0.1 }).status).toBe(200);
  });

  it("入库：读人记录进 Store（只存误差/方向，不存真值）", () => {
    const { http, store } = mkRead();
    http.route("POST", "/match/read", { name: "alice", estimateDeg: 0.1 });
    const st = store.readStats("alice");
    expect(st.reads).toBe(1);
    expect(st.avgErrorDeg).toBeGreaterThanOrEqual(0);
    store.close();
  });
});
