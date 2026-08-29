/**
 * @poolhall/core · 游戏逻辑层
 *
 * 职责（docs/hand-model.md）：局状态、规则、手感系统（hand model）、
 * trial 协议、双层视图（agentView / researchView）。
 * 依赖方向：只可依赖 @poolhall/engine（AGENTS.md §1）。
 */

export type { AgentDecision, OracleInfo, Strategy } from "./agents.ts";
export { makeRandomStrategy, noCompStrategy, oracleStrategy } from "./agents.ts";
export type { ClearObserve, ClearOpts, ClearShotResult } from "./clear.ts";
export { ClearSession } from "./clear.ts";
export type { HandModel, HandNoise, HandTrait, ShotIntent } from "./hand.ts";
export {
  applyHand,
  biasAtShot,
  biasFrom,
  noiseAtShot,
  traitFrom,
  unitUniform,
} from "./hand.ts";
export type {
  AgentMsg,
  EndMsg,
  HelloMsg,
  ObservationMsg,
  ResultMsg,
  ShotMsgT,
} from "./protocol.ts";
export { decodeAgentLine, encode } from "./protocol.ts";
export type { Rng } from "./rng.ts";
export { gaussian, hash32, nextDouble, nextInt, rangeDot, streamOf } from "./rng.ts";
export type { AgentStats, ShotRow } from "./store.ts";

export { Store } from "./store.ts";
export type { CalibOpts, TrialLayout } from "./trial.ts";
export { CalibSession } from "./trial.ts";
export { CORE_VERSION } from "./version.ts";
export type { AgentObserve, AgentShot, ResearchShot } from "./views.ts";
export { agentObserve, assertNoLeak, LEAK_WORDS } from "./views.ts";
