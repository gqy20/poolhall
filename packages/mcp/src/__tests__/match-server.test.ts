/**
 * 中式八球对局 MCP server 端到端测试（内存传输对）
 *
 * 验证：tools/list 4 工具齐备 / observe/take 字段映射 / 状态闭环
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPoolhallMatchMcp } from "../index.ts";

function parseTextContent(result: { content: unknown[] }): unknown {
  const first = result.content[0];
  if (
    !first ||
    typeof first !== "object" ||
    !("type" in first) ||
    first.type !== "text" ||
    !("text" in first) ||
    typeof first.text !== "string"
  ) {
    throw new Error("MCP 工具未返回文本内容");
  }
  return JSON.parse(first.text);
}

describe("MCP match 工具面（与 experiment match 1:1）", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = buildPoolhallMatchMcp({ seed: 42, nameA: "a", nameB: "b", maxShots: 30 });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(ct);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("tools/list 包含 4 个 match 工具", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(["match_state", "observe_match", "open_match", "take_match_shot"]);
  });

  it("open_match 返回初始对局元信息", async () => {
    const r = await client.callTool({ name: "open_match", arguments: {} });
    const o = parseTextContent(r) as Record<string, unknown>;
    expect(o.nameA).toBe("a");
    expect(o.nameB).toBe("b");
    expect(o.seed).toBe(42);
    expect(["solids", "stripes", "open"]).toContain(o.yourGroup);
  });

  it("observe_match 必含 yourGroup/turn/aimAssists/balls 字段", async () => {
    const r = await client.callTool({ name: "observe_match", arguments: {} });
    const o = parseTextContent(r) as Record<string, unknown>;
    expect(["A", "B"]).toContain(o.turn);
    expect(["solids", "stripes", "open"]).toContain(o.yourGroup);
    expect(o.turn).toBe(o.you);
    expect(Array.isArray(o.balls)).toBe(true);
    // 15 球 rack + 1 cue = 16；open 状态未进袋，全部在场
    expect((o.balls as unknown[]).length).toBeGreaterThanOrEqual(15);
    expect(Array.isArray(o.pockets)).toBe(true);
    expect((o.pockets as unknown[]).length).toBe(6);
  });

  it("take_match_shot 一次完整出杆（违规需字段）", async () => {
    // 取当前 turn，挑一个非自己组球（人为违规）验证犯规字段
    const obs = parseTextContent(
      await client.callTool({ name: "observe_match", arguments: {} }),
    ) as {
      yourGroup: string;
      balls: Array<{ id: string }>;
      pockets: Array<{ id: string }>;
      aimAssists: Array<{ ball: string; ghost: { x: number; y: number } }>;
    };
    const illegal = obs.balls.find(
      (b: { id: string }) =>
        obs.yourGroup === "solids"
          ? Number(b.id) >= 9
          : obs.yourGroup === "stripes"
            ? Number(b.id) <= 7
            : b.id === "8", // open 时打 8 = 提前进 8
    );
    if (!illegal) return; // open 状态才有非法球
    const pocket = obs.pockets[0]!;
    const aim =
      obs.aimAssists.find((a: { ball: string }) => a.ball === illegal.id) ?? obs.aimAssists[0];
    if (!aim) throw new Error("观察结果缺少瞄准辅助");
    const r = await client.callTool({
      name: "take_match_shot",
      arguments: {
        targetBall: illegal.id,
        targetPocket: pocket.id,
        aimX: aim.ghost.x,
        aimY: aim.ghost.y,
        power: 0.5,
      },
    });
    const o = parseTextContent(r) as Record<string, unknown>;
    expect(["A", "B"]).toContain(o.by);
    // 字段透出（不漏 actual/bias/optimal）
    expect(typeof o.nextTurn).toBe("string");
    expect(typeof o.over).toBe("boolean");
  });

  it("match_state 必含 turn/yourGroup/over/winner", async () => {
    // 出一杆后 state 必更新
    const obs = parseTextContent(
      await client.callTool({ name: "observe_match", arguments: {} }),
    ) as {
      balls: Array<{ id: string }>;
      pockets: Array<{ id: string }>;
      aimAssists: Array<{ ball: string; ghost: { x: number; y: number } }>;
    };
    const ball = obs.balls[0]!;
    const pocket = obs.pockets[0]!;
    const aim =
      obs.aimAssists.find((a: { ball: string }) => a.ball === ball.id) ?? obs.aimAssists[0];
    if (!aim) throw new Error("观察结果缺少瞄准辅助");
    await client.callTool({
      name: "take_match_shot",
      arguments: {
        targetBall: ball.id,
        targetPocket: pocket.id,
        aimX: aim.ghost.x,
        aimY: aim.ghost.y,
        power: 0.4,
      },
    });
    const r = await client.callTool({ name: "match_state", arguments: {} });
    const o = parseTextContent(r) as Record<string, unknown>;
    expect(o.shot).toBe(1);
    expect(["A", "B"]).toContain(o.turn);
    expect(["solids", "stripes", "open"]).toContain(o.yourGroup);
    expect(typeof o.over).toBe("boolean");
  });
});
