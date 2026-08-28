/**
 * 计数器型 RNG（docs/hand-model.md §3）
 *
 * 设计目标：第 k 杆噪声 = f(seed, agent, k) —— 单杆可独立重算，不污染全局流。
 * 用 pure-rand 的 xoroshiro128plus，种子由 FNV-1a 混合（seed, agent, 用途, 序号）派生。
 */
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import type { JumpableRandomGenerator } from "pure-rand/types/JumpableRandomGenerator";

/** FNV-1a 32bit 多键混合（确定性，跨进程稳定） */
export function hash32(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const raw of parts) {
    const s = String(raw);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // 键分隔符防粘连（"ab","c" vs "a","bc"）
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type Rng = JumpableRandomGenerator;

/** 派生独立随机流：同一 (seed, agent, purpose, index) 永远同流 */
export function streamOf(seed: number, agent: string, purpose: string, index: number): Rng {
  return xoroshiro128plus(hash32(seed, agent, purpose, index));
}

/** 均匀 [0,1)：两抽拼 53bit */
export function nextDouble(g: Rng): number {
  const hi = g.next() >>> 0;
  const lo = g.next() >>> 0;
  return (hi * 2097152 + (lo >>> 11)) / 9007199254740992;
}

/** 均匀整数 [0, n) */
export function nextInt(g: Rng, n: number): number {
  return Math.floor(nextDouble(g) * n) % n;
}

/** 标准正态（Box-Muller；Math.log/cos 为确定性数学函数） */
export function gaussian(g: Rng): number {
  let u = nextDouble(g);
  while (u <= 1e-12) u = nextDouble(g);
  const v = nextDouble(g);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 均匀 [lo, hi) */
export const rangeDot = (g: Rng, lo: number, hi: number): number => lo + (hi - lo) * nextDouble(g);
