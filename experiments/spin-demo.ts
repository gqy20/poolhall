#!/usr/bin/env node
/**
 * v2 spin 涌现 demo（docs/physics.md §3 v2 解冻）
 *
 * 跑两组对比，把两次模拟写进同一份 JSONL（meta + 4 shots）：
 * - 组 A（topspin 球-球）：spin=0 vs spin.z=0.8 直线撞目标球
 * - 组 B（加塞撞库）：spin=0 vs spin.z=+1 向右出杆撞右库
 *
 * 用法：node experiments/spin-demo.ts
 * 输出：experiments/figs/v2-spin-demo.html（file:// 可分享）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBall, simulate, strike, type Spin3, vec2 } from "../packages/engine/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "figs");
const outJsonl = join(outDir, "v2-spin-demo.jsonl");

// 直线球布局：cue(0.3, 0.5) → obj(0.5, 0.5) → rt(1.98, 0)
// 出杆 0.6 m/s + spin.z=+0.8 → top spin 应让 cue 切向偏移
function runTrial(
  spin: Spin3,
  trial: number,
  agent: string,
  setup: "ball-ball" | "cushion",
): object {
  const cue = makeBall("cue", vec2(0.3, 0.5));
  let balls = [cue];
  let optimal = 0;
  if (setup === "ball-ball") {
    const obj = makeBall("1", vec2(0.5, 0.5));
    balls = [cue, obj];
  } else {
    // cushion demo: cue 向右出杆，撞右库
    cue.pos = vec2(0.5, 0.5);
    optimal = 0; // aim=0° 向右
  }
  strike(cue, 0, 0.6, spin);
  const r = simulate(balls, undefined, undefined, { sampleEvery: 0.005 });
  const cueFinal = r.balls.find((b) => b.id === "cue")!;
  const objFinal = r.balls.find((b) => b.id === "1");
  const cueDy = Math.abs(cueFinal.pos.y - 0.5);
  const objDy = objFinal ? Math.abs(objFinal.pos.y - 0.5) : 0;
  return {
    kind: "shot",
    seed: 42,
    agent,
    trial,
    optimal,
    intentAngle: 0,
    intentPower: 0.6,
    actualAngle: 0,
    actualPower: 0.6,
    intentSpin: spin,
    biasAt: 0,
    pot: false,
    pottedPocket: null,
    finalBalls: {
      cue: { x: cueFinal.pos.x, y: cueFinal.pos.y },
      ...(objFinal ? { "1": { x: objFinal.pos.x, y: objFinal.pos.y } } : {}),
    },
    samples: r.samples,
    events: r.events,
    _meta: { cueDy, objDy, simTime: r.simTime, setup },
  };
}

const meta = {
  kind: "meta",
  agent: "v2-spin-demo",
  seed: 42,
  trials: 4,
  promptVersion: "v2-spin-physics",
  biasOverride: 0,
};

const s0 = runTrial({ x: 0, y: 0, z: 0 }, 0, "ball-ball spin=0", "ball-ball");
const sTop = runTrial({ x: 0, y: 0, z: 0.8 }, 1, "ball-ball topspin=0.8", "ball-ball");
const c0 = runTrial({ x: 0, y: 0, z: 0 }, 2, "cushion spin=0", "cushion");
const cSide = runTrial({ x: 0, y: 0, z: 1 }, 3, "cushion side=+1", "cushion");

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outJsonl,
  [meta, s0, sTop, c0, cSide].map((r) => JSON.stringify(r)).join("\n") + "\n",
);

console.log(`✓ spin-demo JSONL: ${outJsonl}`);
console.log(`\n组 A · 球-球（直线撞目标球）`);
console.log(`  spin=0:        cueDy=${s0._meta.cueDy.toFixed(4)}m  objDy=${s0._meta.objDy.toFixed(4)}m`);
console.log(`  topspin 0.8:   cueDy=${sTop._meta.cueDy.toFixed(4)}m  objDy=${sTop._meta.objDy.toFixed(4)}m`);
console.log(`\n组 B · 库边加塞（向右出杆撞右库）`);
console.log(`  spin=0:        cueDy=${c0._meta.cueDy.toFixed(4)}m`);
console.log(`  side +1:       cueDy=${cSide._meta.cueDy.toFixed(4)}m`);
