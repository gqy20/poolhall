/**
 * 真模型外部座驱动（实测）：用 LlmAgentSession（prompts/match.yaml）经入座层打一局
 *
 * 与 smoke.ts（oracle 脚本）不同——这里的每一杆都是真实模型决策，用于评估
 * "外部接入 + 手感注入 + 反馈回路"全链路的真模型表现（docs/match.md §6）。
 *
 * 用法：
 *   poolhall lobby --port 8830 --a external --b external ...
 *   node packages/cli/src/llm-seat.ts <身份名> [remote 基址] [桌号]
 *   node packages/cli/src/llm-seat.ts alice http://127.0.0.1:8830
 *
 * 反馈回路：出杆后轮询 /match/state.lastShot 拿本杆公开事实（进袋/犯规/首触），
 * 回写 LlmAgentSession.feedback——与进程内 match-run 的反馈语义一致。
 */
import type { MatchObserve } from "@poolhall/core";
import { MatchRemoteClient, RemoteMatchError } from "@poolhall/mcp";
import { LlmAgentSession } from "./llm.ts";

const name = process.argv[2] ?? "alice";
const base = process.argv[3] ?? "http://127.0.0.1:8830";
const wantTable = process.argv[4] ?? null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 预期流程错误（未开局/门控竞态）→ 返回 null 重试；网络/服务端错误照抛 */
async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RemoteMatchError && (error.status === 503 || error.status === 409)) {
      return null;
    }
    throw error;
  }
}

interface ShotFacts {
  shot: number;
  by: "A" | "B";
  targetBall: string | null;
  targetPocket: string | null;
  pottedBalls: string[];
  pottedPockets: Array<{ ball: string; pocket: string }>;
  scratch: boolean;
  firstContact: string | null;
  foul: string | null;
  nextTurn: string;
  over: boolean;
}

interface StateView {
  shot: number;
  turn: "A" | "B";
  over: boolean;
  winner: string | null;
  reason: string | null;
  waitingFor: string | null;
  lastShot: ShotFacts | null;
  recentShots: ShotFacts[];
}

async function main(): Promise<void> {
  const client = new MatchRemoteClient(base, name);
  const join = await client.join();
  const seat = join.seat;
  const table = wantTable ?? join.table ?? null;
  if (table) client.table = table;
  console.error(`[llm-seat] ${name} 入座 ${seat}（桌 ${table ?? "单桌"}）`);

  const llm = new LlmAgentSession(undefined, "match");
  let lastFactsShot = -1;

  for (;;) {
    const state = (await soft(() => client.state())) as StateView | null;
    if (!state) {
      await sleep(500); // 未开局（等人入座）或门控竞态——等
      continue;
    }
    if (state.over) {
      console.error(
        `[llm-seat] 对局结束：${state.winner ? `${state.winner} 胜` : "平局"}——${state.reason}（${state.shot} 杆）`,
      );
      break;
    }
    // 反馈回路：本座所有尚未回写的杆结果逐杆 feedback（recentShots 环形缓冲，
    // 不受对手下一杆覆盖；按 shot 序补齐）
    const own = (state.recentShots ?? [])
      .filter((f) => f.by === seat && f.shot > lastFactsShot)
      .sort((a, b) => a.shot - b.shot);
    for (const fact of own) {
      lastFactsShot = fact.shot;
      deliverFeedback(llm, fact);
    }
    if (state.turn !== seat) {
      await sleep(300);
      continue;
    }
    const obs = (await soft(() => client.observe())) as MatchObserve | null;
    if (!obs || obs.kind !== "match-observe") {
      await sleep(300);
      continue;
    }
    const shot = obs.breakShot ? breakShot(obs) : await llm.shotMatch(obs);
    if (!shot || !shot.aimAt) {
      console.error("[llm-seat] 模型无决策，重试");
      await sleep(500);
      continue;
    }
    const prediction = obs.breakShot
      ? "开球：直击顶球冲散球组"
      : `${shot.publicPlan.observation}｜${shot.publicPlan.choice}`;
    const res = await soft(() =>
      client.shot({
        aimX: shot.aimAt!.x,
        aimY: shot.aimAt!.y,
        power: shot.power,
        spin: shot.spin,
        targetBall: shot.targetBall,
        targetPocket: shot.targetPocket,
        prediction,
      }),
    );
    const accepted = res as { ok?: boolean } | null;
    if (accepted?.ok) {
      console.error(
        `[llm-seat] ${name} 第 ${state.shot} 杆：${shot.targetBall}→${shot.targetPocket} ` +
          `p=${shot.power.toFixed(2)} ${obs.breakShot ? "(开球)" : ""}`,
      );
    }
    await sleep(200);
  }
}

/** 开球决策：与 match-run 的 breakIntent 同语义——直击 1 号顶点 */
function breakShot(obs: MatchObserve) {
  const cue = obs.balls.find((b) => b.id === "cue")!;
  const apex = obs.balls.find((b) => b.id === "1") ?? obs.balls[0]!;
  return {
    angle: 0,
    power: 0.85,
    aimAt: { x: apex.x, y: apex.y },
    spin: { x: 0, y: 0, z: 0 },
    targetBall: "1",
    targetPocket: "ct",
    publicPlan: {
      observation: "开球",
      choice: "直击顶球",
      cuePlan: "高力度冲散",
      risk: "母球进袋",
      confidence: "medium" as const,
    },
  };
}

function deliverFeedback(llm: LlmAgentSession, facts: ShotFacts): void {
  const potted = facts.pottedBalls.length > 0 && !facts.foul;
  const desc = facts.foul
    ? facts.foul
    : potted
      ? null
      : facts.scratch
        ? "母球进袋"
        : facts.firstContact && facts.targetBall && facts.firstContact !== facts.targetBall
          ? `首触 ${facts.firstContact}（非目标 ${facts.targetBall}）`
          : "未进";
  llm.feedback(potted, facts.pottedPockets[0]?.pocket ?? null, [], desc, {
    trial: facts.shot,
    aim: { x: 0, y: 0 },
    angleUsed: 0,
    spinUsed: null,
    potted,
    pottedPocket: facts.pottedPockets[0]?.pocket ?? null,
    sideNote: desc,
  });
}

main().catch((error) => {
  console.error("[llm-seat] 失败：", error);
  process.exit(1);
});
