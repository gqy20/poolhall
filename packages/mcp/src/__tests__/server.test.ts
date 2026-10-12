/**
 * MCP server 端对端测试（内存传输对：InMemoryTransport + Client）
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPoolhallMcp } from "../index.ts";

/** 工具结果 content 文本提取（联合类型里只取 text 字段） */
const contentText = (content: unknown): string =>
  (content as Array<{ type: string; text?: string }>)[0]!.text ?? "";

describe("MCP 工具面（与 CLI 命令 1:1）", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = buildPoolhallMcp({ seed: 42, agent: "test-agent", trials: 3 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("tools/list 包含四个工具", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_score", "get_shot_history", "observe_table", "take_shot"]);
  });

  it("observe_table 返回 AgentView 白名单字段", async () => {
    const r = await client.callTool({ name: "observe_table", arguments: {} });
    const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed).sort()).toEqual([
      "aimAssist",
      "balls",
      "pockets",
      "score",
      "targetPocket",
      "trial",
      "trialCount",
    ]);
    expect(parsed.balls).toHaveLength(2);
  });

  it("完整局：打 3 杆走完 3 trial，分数与历史一致", async () => {
    for (let k = 0; k < 3; k++) {
      const obs = await client.callTool({ name: "observe_table", arguments: {} });
      const o = JSON.parse(contentText(obs.content));
      const shot = await client.callTool({
        name: "take_shot",
        arguments: { angle: 30, power: 0.3 },
      });
      const s = JSON.parse(contentText(shot.content));
      expect(s.trial).toBe(o.trial);
      expect(typeof s.potted).toBe("boolean");
      expect(typeof s.score).toBe("number");
    }
    const score = await client.callTool({ name: "get_score", arguments: {} });
    const s = JSON.parse(contentText(score.content));
    expect(s.trials).toBe(3);
    expect(s.trial).toBe(3);

    const hist = await client.callTool({ name: "get_shot_history", arguments: { limit: 5 } });
    const h = JSON.parse(contentText(hist.content));
    expect(h).toHaveLength(3);
  });

  it("泄漏红线：任何工具输出序列化后不含 bias/actual/optimal 等禁词", async () => {
    await client.callTool({ name: "observe_table", arguments: {} });
    const shot = await client.callTool({ name: "take_shot", arguments: { angle: 45, power: 0.4 } });
    const txt = contentText(shot.content);
    for (const w of ["bias", "sigma", "actual", "optimal", "drift", "noise", "hand"]) {
      expect(txt.toLowerCase()).not.toContain(w);
    }
  });
});
