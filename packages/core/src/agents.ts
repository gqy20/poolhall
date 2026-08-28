/**
 * 合成对照 agent（docs/benchmark.md §5 验机用；真模型 harness 在 M3 接入）
 * 纯函数策略：输入观察 + 偷看的 research 事实 → 出杆意图。
 */
import { solvePot, type Vec2 } from "@poolhall/engine";
import type { AgentObserve } from "./views.ts";

export interface AgentDecision {
  angle: number;
  power: number;
}

export type Strategy = (view: AgentObserve, extra: OracleInfo) => AgentDecision;

/** 偷看通道（仅合成 agent / research 使用；真模型永不接触） */
export interface OracleInfo {
  cuePos: Vec2;
  objPos: Vec2;
  pocketCenter: Vec2;
  R: number;
  /** 当前杆的真实 bias（含漂移）——oracle 靠它一步消除系统差 */
  bias: number;
}

/**
 * oracle：最优角 − 当前 bias → 残余误差只剩 ε（正态小噪声）。
 * 期望进球率 ≥90%（DoD 口径），用于验证 benchmark 管线可达性。
 */
export const oracleStrategy: Strategy = (_view, info) => {
  const ang = solvePot(info.cuePos, info.objPos, info.pocketCenter, info.R);
  const angle = ang === null ? 0 : ang;
  return {
    angle: angle - info.bias,
    power: 0.5,
  };
};

/**
 * no-comp 对照：永远用最优角、从不补偿（策略机器自检的"平直线"对照组）
 */
export const noCompStrategy: Strategy = (_view, info) => {
  const ang = solvePot(info.cuePos, info.objPos, info.pocketCenter, info.R);
  return { angle: ang === null ? 0 : ang, power: 0.5 };
};

/** random：确定性乱打（每 trial 独立流） */
export const randomStrategy = makeRandomStrategy("random");

export function makeRandomStrategy(agent: string): Strategy {
  return (view, _info) => {
    // 从独立流派生确定性"乱打"角度（低 power 几乎必然 miss）
    const g = streamOfSafe(agent, view.trial);
    return {
      angle: g.a,
      power: g.b,
    };
  };
}

import { rangeDot, streamOf } from "./rng.ts";

function streamOfSafe(agent: string, trial: number): { a: number; b: number } {
  const g = streamOf(0, agent, "random", trial);
  const a = rangeDot(g, -180, 180);
  const b = rangeDot(g, 0.2, 0.6);
  return { a, b };
}
