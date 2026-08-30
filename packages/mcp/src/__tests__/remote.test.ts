/**
 * 远程对局客户端 + remote 模式 MCP server 测试（M6.3）
 *
 * fetch 用桩代替：验证请求路径/载荷、错误包装、工具面代理行为。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { buildPoolhallMatchRemoteMcp } from "../index.ts";
import { MatchRemoteClient, RemoteMatchError } from "../remote.ts";

interface FakeRoute {
  status?: number;
  body: unknown;
}

interface FakeFetch {
  fetch: typeof fetch;
  calls: Array<{ method: string; path: string; search: string; body: unknown }>;
}

/** 按 "METHOD /path" 命中的 fetch 桩 */
function fakeFetch(routes: Record<string, FakeRoute>): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fetchFn = (async (input: string | URL, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      search: url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const hit = routes[`${method} ${url.pathname}`];
    if (!hit) throw new Error(`未桩路由：${method} ${url.pathname}`);
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe("MatchRemoteClient", () => {
  it("join/observe/shot/state 的路径与载荷", async () => {
    const fake = fakeFetch({
      "POST /match/join": {
        body: { ok: true, seat: "A", seats: { A: "x", B: "y" }, shotClockMs: 0 },
      },
      "GET /match/state": { body: { turn: "A" } },
      "GET /match/observe": { body: { kind: "match-observe" } },
      "POST /match/shot": { status: 202, body: { ok: true, by: "A" } },
    });
    const client = new MatchRemoteClient("http://h:8788/", "x", fake.fetch);
    expect((await client.join()).seat).toBe("A");
    await client.state();
    await client.observe();
    await client.shot({ aimX: 1, aimY: 0.5, power: 0.5, targetBall: "1", targetPocket: "rt" });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /match/join",
      "GET /match/state",
      "GET /match/observe",
      "POST /match/shot",
    ]);
    expect(fake.calls[0]!.body).toEqual({ name: "x" });
    expect(fake.calls[3]!.body).toMatchObject({ name: "x", targetBall: "1" });
  });

  it("非 2xx 抛 RemoteMatchError（携带状态与错误体）", async () => {
    const fake = fakeFetch({
      "POST /match/shot": { status: 409, body: { error: "还没轮到你", turn: "B" } },
    });
    const client = new MatchRemoteClient("http://h:8788", "x", fake.fetch);
    await expect(
      client.shot({ aimX: 1, aimY: 0.5, power: 0.5, targetBall: "1", targetPocket: "rt" }),
    ).rejects.toMatchObject({ status: 409, payload: { turn: "B" } });
    try {
      await client.shot({ aimX: 1, aimY: 0.5, power: 0.5, targetBall: "1", targetPocket: "rt" });
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteMatchError);
    }
  });

  it("大厅模式：join 响应携带 table，后续请求自动透传 ?table=", async () => {
    const fake = fakeFetch({
      "POST /match/join": {
        body: { ok: true, seat: "A", seats: { A: "x", B: "y" }, shotClockMs: 0, table: "t2" },
      },
      "GET /match/state": { body: { turn: "A" } },
      "GET /match/observe": { body: { kind: "match-observe" } },
    });
    const client = new MatchRemoteClient("http://h:8800", "x", fake.fetch);
    await client.join();
    await client.state();
    await client.observe();
    expect(fake.calls[1]!.search).toBe("?table=t2");
    expect(fake.calls[2]!.search).toContain("table=t2");
    expect(fake.calls[2]!.search).toContain("name=x");
  });

  it("read：读人载荷携带身份名与桌号", async () => {
    const fake = fakeFetch({
      "POST /match/join": {
        body: { ok: true, seat: "B", seats: { A: "y", B: "x" }, shotClockMs: 0, table: "t1" },
      },
      "POST /match/read": {
        body: { ok: true, target: "A", errorDeg: 0.08, directionCorrect: true, attemptsLeft: 2 },
      },
    });
    const client = new MatchRemoteClient("http://h:8800", "x", fake.fetch);
    await client.join();
    const out = (await client.read(0.12)) as Record<string, unknown>;
    expect(out).toMatchObject({ directionCorrect: true, attemptsLeft: 2 });
    expect(fake.calls[1]!.path).toBe("/match/read");
    expect(fake.calls[1]!.search).toBe("?table=t1");
    expect(fake.calls[1]!.body).toEqual({ name: "x", estimateDeg: 0.12 });
  });
});

function parseText(result: { content: unknown[] }): Record<string, unknown> {
  const first = result.content[0] as { type: string; text: string };
  return JSON.parse(first.text);
}

describe("remote 模式 MCP server（端到端，内存传输 + fetch 桩）", () => {
  async function setup(routes: Record<string, FakeRoute>) {
    const fake = fakeFetch(routes);
    const server = await buildPoolhallMatchRemoteMcp({
      remote: "http://h:8788",
      agent: "x",
      fetchFn: fake.fetch,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0.0.1" });
    await client.connect(ct);
    return {
      client,
      fake,
      cleanup: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("tools/list 5 工具；open_match 返回入座信息", async () => {
    const { client, cleanup } = await setup({
      "POST /match/join": {
        body: { ok: true, seat: "B", seats: { A: "y", B: "x" }, shotClockMs: 600000 },
      },
    });
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "match_state",
      "observe_match",
      "open_match",
      "read_opponent",
      "take_match_shot",
    ]);
    const open = parseText(await client.callTool({ name: "open_match", arguments: {} }));
    expect(open).toMatchObject({ joined: true, seat: "B", you: "x" });
    await cleanup();
  });

  it("没轮到你：409 转成可读 JSON（waiting），不是工具错误", async () => {
    const { client, cleanup } = await setup({
      "POST /match/join": {
        body: { ok: true, seat: "B", seats: { A: "y", B: "x" }, shotClockMs: 0 },
      },
      "GET /match/observe": { status: 409, body: { error: "还没轮到你", turn: "A" } },
    });
    const obs = parseText(await client.callTool({ name: "observe_match", arguments: {} }));
    expect(obs).toMatchObject({ waiting: true, status: 409, turn: "A" });
    await cleanup();
  });

  it("take_match_shot 代理出杆载荷", async () => {
    const fakeRoutes: Record<string, FakeRoute> = {
      "POST /match/join": {
        body: { ok: true, seat: "A", seats: { A: "x", B: "y" }, shotClockMs: 0 },
      },
      "POST /match/shot": { status: 202, body: { ok: true, by: "A" } },
    };
    const { client, fake, cleanup } = await setup(fakeRoutes);
    const out = parseText(
      await client.callTool({
        name: "take_match_shot",
        arguments: { targetBall: "1", targetPocket: "rt", aimX: 1, aimY: 0.5, power: 0.4 },
      }),
    );
    expect(out).toMatchObject({ ok: true, by: "A" });
    expect(fake.calls[1]!.body).toMatchObject({ name: "x", targetBall: "1", aimX: 1 });
    await cleanup();
  });
});
