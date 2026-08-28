/**
 * 手感系统（docs/hand-model.md §1/§2/§3）
 *
 * actual = intent + bias + ε；bias 按 OU 过程逐杆漂移（闭式量，单杆可重算）。
 * 隐藏参数永不出现在 AgentView（views.ts 泄漏红线）。
 */
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { gaussian, hash32, nextDouble, rangeDot } from "./rng.ts";

export interface HandTrait {
  /** 角度高斯噪声 σ（度）。注意碰撞圆杠杈（瞄偏 ε→目标球出射 bow ε·L/2R），
   *  L≈0.7m 时放大 ~12×：σ=0.05° 实际作用于目标球出射约 0.6° */
  angleSigma: number;
  /** 力度相对高斯噪声 σ（×速度比例） */
  powerSigma: number;
  /** OU 回归率（1/杆） */
  driftKappa: number;
  /** OU 步进幅度（度） */
  driftSigma: number;
}

export interface HandModel extends HandTrait {
  /** 局初系统偏差（度），跨局由身份种子决定（docs/hand-model.md §3） */
  biasBase: number;
}

export interface ShotIntent {
  angle: number;
  power: number;
}

export interface HandNoise {
  epsAngle: number;
  epsPower: number;
  biasAt: number;
}

/** 身份偏差：同一 (serverSeed, agent) 永远同 bias，方向随机，量级 ±[0.05°, 0.2°]
 *  （量级论证见 docs/hand-model.md §2：碰撞圆杠杈放大后，中线容差 ≈ ±2.5°，
 *   0.05–0.2° 的系统偏差足以在中远台造成可统计发现的系统性 miss）*/
export function biasFrom(seed: number, agent: string): number {
  const g = xoroshiro128plus(hash32(seed, agent, "bias", 0));
  const mag = rangeDot(g, 0.05, 0.2);
  const sign = g.next() % 2 === 0 ? 1 : -1;
  return sign * mag;
}

/** 手感特性：每局重抽（σ 与漂移参数） */
export function traitFrom(seed: number, agent: string, session: number): HandTrait {
  const g = xoroshiro128plus(hash32(seed, agent, "trait", session));
  return {
    angleSigma: rangeDot(g, 0.02, 0.08),
    powerSigma: rangeDot(g, 0.02, 0.05),
    driftKappa: 0.02,
    driftSigma: 0.03,
  };
}

/**
 * OU 闭式解（不渡历）：b_i = (1−κ)^i·b0 + σ_b·√κ·Σ_j (1−κ)^(i−j)·ζ_j
 * 每个 ζ_j 独立流（purpose="drift", j），单杆重算 O(i)，i≤trialCount 级别可接受。
 */
export function biasAtShot(
  hand: HandModel | HandTrait,
  index: number,
  seed: number,
  agent: string,
): number {
  const biasBase = "biasBase" in hand ? (hand.biasBase as number) : 0;
  const decay = (1 - hand.driftKappa) ** index;
  let acc = 0;
  for (let j = 1; j <= index; j++) {
    const g = gaussian(xoroshiro128plus(hash32(seed, agent, "drift", j)));
    acc += (1 - hand.driftKappa) ** (index - j) * g;
  }
  return biasBase * decay + hand.driftSigma * Math.sqrt(hand.driftKappa) * acc;
}

/** 第 k 杆正态噪声对（独立流） */
export function noiseAtShot(
  hand: HandTrait,
  index: number,
  seed: number,
  agent: string,
): HandNoise {
  const g = xoroshiro128plus(hash32(seed, agent, "noise", index));
  return {
    epsAngle: gaussian(g) * hand.angleSigma,
    epsPower: gaussian(g) * hand.powerSigma,
    biasAt: biasAtShot(hand, index, seed, agent),
  };
}

/** 注入：actual = intent + bias + ε（power 按比例噪声并夹到 [0,1]） */
export function applyHand(intent: ShotIntent, noise: HandNoise): ShotIntent {
  return {
    angle: intent.angle + noise.biasAt + noise.epsAngle,
    power: Math.min(1, Math.max(0, intent.power * (1 + noise.epsPower))),
  };
}

/** 测试/调试用：确定性均匀数（供合成 agent 抽布局决策） */
export function unitUniform(seed: number, agent: string, purpose: string): number {
  return nextDouble(xoroshiro128plus(hash32(seed, agent, purpose, 0)));
}
