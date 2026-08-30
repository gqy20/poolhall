import { MATCH_EVENT_SCHEMA } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import { WsHub } from "../match-ws/server.ts";

describe("WsHub", () => {
  it("可监听临时端口、记录消息并完整关闭", async () => {
    const hub = new WsHub(0, "127.0.0.1");
    await hub.start();
    const port = hub.boundPort();
    expect(port).toBeGreaterThan(0);

    hub.broadcast({
      type: "hello",
      schema: MATCH_EVENT_SCHEMA,
      seed: 42,
      nameA: "A",
      nameB: "B",
      promptA: null,
      promptB: null,
      table: { width: 2.54, height: 1.27, breakLineX: 0.635, footSpotX: 1.905 },
    });
    expect(hub.history).toHaveLength(1);
    expect(await fetch(`http://127.0.0.1:${port}`).then((r) => r.text())).toContain("PoolHall");

    const replay = new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))));
      ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")));
    });
    await expect(replay).resolves.toMatchObject({ type: "hello", seed: 42 });

    await hub.close();
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
  });

  it("拒绝向观战端广播隐藏状态", () => {
    const hub = new WsHub(0, "127.0.0.1");
    expect(() =>
      hub.broadcast({
        type: "hello",
        schema: MATCH_EVENT_SCHEMA,
        seed: 42,
        nameA: "A",
        nameB: "B",
        promptA: null,
        promptB: null,
        table: { width: 2.54, height: 1.27, breakLineX: 0.635, footSpotX: 1.905 },
        actualAngle: 1,
      } as never),
    ).toThrow(/actualAngle/);
  });

  it("接收浏览器发来的新局控制消息并可清空历史", async () => {
    const hub = new WsHub(0, "127.0.0.1");
    await hub.start();
    const control = new Promise<{ type: string; maxShots: number }>((resolve) => {
      hub.onControl(resolve);
    });
    const ws = new WebSocket(`ws://127.0.0.1:${hub.boundPort()}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")));
    });
    ws.send(JSON.stringify({ type: "new_match", maxShots: 36 }));
    await expect(control).resolves.toEqual({ type: "new_match", maxShots: 36 });
    hub.clearHistory();
    expect(hub.history).toHaveLength(0);
    await hub.close();
  });
});
