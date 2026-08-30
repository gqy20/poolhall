/**
 * M6.3 冒烟：以“外部选手”身份经 MCP remote 模式驱动 web-match 的一个座位
 *
 * 用法：
 *   pnpm exec poolhall web-match --a external --b external \
 *     --name-a extA --name-b extB --port 8899
 *   node packages/mcp/src/smoke.ts A            # 座位 A（身份名须与 --name-a 相符）
 *   node packages/mcp/src/smoke.ts B http://127.0.0.1:8900 extB
 *
 * 驱动策略：oracle 同款——每回合等轮到自己，选最小切角组合瞄 ghost。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildPoolhallMatchRemoteMcp } from "./index.ts";

const seatArg = process.argv[2] ?? "A";
const remote = process.argv[3] ?? "http://127.0.0.1:8900";
const agent = process.argv[4] ?? (seatArg === "A" ? "extA" : "extB");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]!.text);
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return parse(await client.callTool({ name, arguments: args }));
}

async function main(): Promise<void> {
  const server = await buildPoolhallMatchRemoteMcp({ remote, agent });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: `smoke-${agent}`, version: "0.0.1" });
  await client.connect(ct);
  const join = await call(client, "open_match");
  console.error(`[smoke] ${agent} 入座 ${join.seat}（对手桌位 ${JSON.stringify(join.seats)}）`);

  let shots = 0;
  for (;;) {
    const state = await call(client, "match_state");
    if (state.over) {
      console.error(
        `[smoke] 对局结束：${state.winner ? `${state.winner} 胜` : "平局"}——${state.reason}（${state.shot} 杆，我出 ${shots} 杆）`,
      );
      break;
    }
    if (state.turn !== join.seat) {
      await sleep(300);
      continue;
    }
    const obs = await call(client, "observe_match");
    if ("waiting" in obs) {
      await sleep(200);
      continue;
    }
    const assists = obs.aimAssists as Array<{
      ball: string;
      pocket: string;
      ghost: { x: number; y: number };
      cutAngleDeg: number;
    }>;
    if (assists.length === 0) {
      console.error("[smoke] 无可用瞄点，等一拍");
      await sleep(500);
      continue;
    }
    const best = assists.reduce((a, b) => (b.cutAngleDeg < a.cutAngleDeg ? b : a));
    const shot = await call(client, "take_match_shot", {
      targetBall: best.ball,
      targetPocket: best.pocket,
      aimX: best.ghost.x,
      aimY: best.ghost.y,
      power: obs.breakShot ? 0.85 : 0.6,
      spin: obs.breakShot ? undefined : { x: 0, y: -0.4, z: 0 },
      prediction: `smoke：计划打进 ${best.ball} 号（切角 ${best.cutAngleDeg.toFixed(1)}°）`,
    });
    if ("waiting" in shot) {
      await sleep(200);
      continue;
    }
    shots += 1;
    console.error(`[smoke] ${agent} 第 ${shots} 杆：打 ${best.ball} → ${best.pocket}`);
    await sleep(1200); // 给观战播放留节奏
  }
  await client.close();
  await server.close();
}

main().catch((error) => {
  console.error("[smoke] 失败：", error);
  process.exit(1);
});
