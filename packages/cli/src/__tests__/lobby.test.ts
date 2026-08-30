/**
 * 常驻大厅端到端测试：真实 HTTP + fetch 直接驱动外部选手
 *
 * 覆盖：认座分配 / 满员等候名单 / 凑齐自动开局 / 回合门控 / 打完自动续局（肌肉记忆连续性）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LobbyHandle, startLobby } from "../lobby.ts";

let lobby: LobbyHandle;
let base = "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function until(check: () => Promise<boolean>, timeoutMs = 25000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(200);
  }
  throw new Error("等待超时");
}

async function status(): Promise<Record<string, unknown>> {
  const r = await api("/lobby/status");
  return (r.body.tables as Array<Record<string, unknown>>)[0]!;
}

beforeAll(async () => {
  lobby = await startLobby({
    host: "127.0.0.1",
    port: "0",
    seed: "42",
    tables: "1",
    a: "external",
    b: "external",
    maxShots: "2",
    // 5 秒出杆限时：兼作离席测试的兑底（离席后卡住的等待超时判负，桌回到等位）
    shotClock: "5",
    eventOutDir: "",
    db: "",
  });
  base = `http://127.0.0.1:${lobby.port}`;
}, 20000);

afterAll(async () => {
  await lobby.close();
});

describe("常驻大厅（M6.4）", () => {
  it("开局前：桌处于等待入座状态", async () => {
    const s = await status();
    expect(s.id).toBe("t1");
    expect(s.state).toBe("waiting");
  });

  it("认座：两人先后入座，第三人进等候名单", async () => {
    expect(await api("/match/join", "POST", { name: "alice" })).toMatchObject({
      status: 200,
      body: { seat: "A", table: "t1" },
    });
    expect(await api("/match/join", "POST", { name: "bob" })).toMatchObject({
      status: 200,
      body: { seat: "B", table: "t1" },
    });
    // 幂等：重复入座返回原席位
    expect(await api("/match/join", "POST", { name: "alice" })).toMatchObject({
      status: 200,
      body: { seat: "A" },
    });
    const third = await api("/match/join", "POST", { name: "carol" });
    expect(third.status).toBe(409);
    expect(third.body.waiting).toContain("carol");
  });

  it("凑齐自动开局：回合门控下打完 2 杆并自动续局", async () => {
    await until(async () => (await status()).state === "playing");
    // 第一局：2 杆盲打（aim 指向桌面空处），回合在服务端门控
    for (let i = 0; i < 2; i++) {
      const s = await status();
      const seats = s.seats as { A: string; B: string };
      const other = s.turn === "A" ? seats.B : seats.A;
      const wrong = await api(`/match/shot?table=t1`, "POST", {
        name: other,
        aimX: 1.0,
        aimY: 0.635,
        power: 0.25,
        targetBall: "1",
        targetPocket: "rt",
      });
      expect(wrong.status).toBe(409);
      // 重试到受理：playing 状态与等待挂起之间有时间窗，轮次也可能因进袋连续
      await until(async () => {
        const st = await status();
        const names = st.seats as { A: string; B: string };
        const shooter = st.turn === "A" ? names.A : names.B;
        const right = await api(`/match/shot?table=t1`, "POST", {
          name: shooter,
          aimX: 1.0,
          aimY: 0.635,
          power: 0.25,
          targetBall: "1",
          targetPocket: "rt",
        });
        return right.status === 202;
      });
      await until(async () => Number((await status()).shot) > i);
    }
    // 杆数预算 2 耗尽 → 本局结束（终局瞬间捕获 reason）→ 席位仍在 → 自动续局（game=1）
    let ended: Record<string, unknown> | null = null;
    await until(async () => {
      const st = await status();
      if (st.over) {
        ended = st;
        return true;
      }
      return false;
    });
    expect((ended as Record<string, unknown> | null)?.reason).toBe("杆数预算耗尽——平局");
    await until(async () => Number((await status()).game) >= 1);
    expect(((await status()).seats as { A: string }).A).toBe("alice");
    // 终局已入 Elo 榜：平局各计一场，初始分不变（同分对局 delta=0）
    const lb = ((await api("/lobby/status")).body.leaderboard ?? []) as Array<
      Record<string, unknown>
    >;
    expect(lb.map((e) => e.name).sort()).toEqual(["alice", "bob"]);
    expect(lb.every((e) => e.games === 1 && e.draws === 1 && e.rating === 1500)).toBe(true);
  }, 40000);

  it("离席：释放席位后桌回到等待状态", async () => {
    expect(await api("/match/leave", "POST", { name: "alice" })).toMatchObject({ status: 200 });
    await until(async () => (await status()).state !== "playing");
    const seats = (await status()).seats as { A: string | null };
    expect(seats.A).toBeNull();
  }, 30000);
});
