/**
 * 双层视图（docs/hand-model.md §6 泄漏红线）
 *
 * AgentView：agent 能看到的一切（球位、任务、分数）——物理上不可能包含隐藏参数。
 * ResearchView：intent/actual/optimal 三元组 + 手感参数——仅供实验与调试。
 *
 * 红线：AgentView 的字段白名单由类型守卫，任何手 mod 字段必须先过这里的类型。
 */
import type { ShotIntent } from "./hand.ts";

/** Agent 观察载荷（白名单字段，键固定） */
export interface AgentObserve {
  kind: "observe";
  trial: number;
  trialCount: number;
  score: number;
  targetPocket: string;
  balls: Array<{ id: string; x: number; y: number }>;
}

/** Agent 出杆载荷（与 docs/proto.md §1.2 对齐） */
export interface AgentShot {
  kind: "shot";
  angle: number;
  power: number;
  spin?: number;
}

/** 研究记录：三元组（intent/actual/optimal）——永不进 AgentView */
export interface ResearchShot {
  trial: number;
  intent: ShotIntent;
  actual: ShotIntent;
  optimal: number | null;
  noise: { epsAngle: number; epsPower: number; biasAt: number };
  pot: boolean;
  pottedPocket: string | null;
  finalPos: Record<string, { x: number; y: number }>;
}

/** AgentView 构造（唯一入口；白名单） */
export function agentObserve(
  trial: number,
  trialCount: number,
  score: number,
  targetPocket: string,
  balls: Array<{ id: string; x: number; y: number }>,
): AgentObserve {
  return { kind: "observe", trial, trialCount, score, targetPocket, balls };
}

/** 全量禁词（泄漏扫描测试用，docs/hand-model.md §6） */
export const LEAK_WORDS = ["bias", "sigma", "actual", "optimal", "drift", "hand", "noise"] as const;

/** 泄漏检测：任何 AgentView JSON 串不得含禁词；违者抛错（fail fast） */
export function assertNoLeak(payload: AgentObserve): void {
  const s = JSON.stringify(payload).toLowerCase();
  for (const w of LEAK_WORDS) {
    if (s.includes(w)) {
      throw new Error(`泄漏红线：AgentObserve 含禁词 "${w}"（views.ts）`);
    }
  }
}
