#!/usr/bin/env node
/**
 * v2 spin 涌现 demo（docs/physics.md §3 v2 解冻）
 *
 * 跑 spin=0 和 spin=+0.8 同布局（cue→obj→rt 直线球），
 * 把两次模拟写进同一份 JSONL（meta + 2 shots），
 * 再用 render-html.ts 渲染对比 HTML。
 *
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
function runTrial(spin: Spin3, trial: number, agent: string): object {
  const cue = makeBall("cue", vec2(0.3, 0.5));
  const obj = makeBall("1", vec2(0.5, 0.5));
  strike(cue, 0, 0.6, spin);
  const r = simulate([cue, obj], undefined, undefined, { sampleEvery: 0.005 });
  const cueFinal = r.balls.find((b) => b.id === "cue")!;
  const objFinal = r.balls.find((b) => b.id === "1")!;
  const cueDy = Math.abs(cueFinal.pos.y - 0.5);
  const objDy = Math.abs(objFinal.pos.y - 0.5);
  return {
    kind: "shot",
    seed: 42,
    agent,
    trial,
    optimal: 0, // 直线球，aim=0°
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
      "1": { x: objFinal.pos.x, y: objFinal.pos.y },
    },
    samples: r.samples,
    events: r.events,
    // 调试字段（HTML 渲染会用到）
    _meta: { cueDy, objDy, simTime: r.simTime },
  };
}

const meta = {
  kind: "meta",
  agent: "v2-spin-demo",
  seed: 42,
  trials: 2,
  promptVersion: "v2-spin-physics",
  biasOverride: 0,
};

const s0 = runTrial({ x: 0, y: 0, z: 0 }, 0, "spin-zero");
const sTop = runTrial({ x: 0, y: 0, z: 0.8 }, 1, "topspin-08");

mkdirSync(outDir, { recursive: true });
writeFileSync(outJsonl, [meta, s0, sTop].map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`✓ spin-demo JSONL: ${outJsonl}`);
console.log(`  trial 0 (spin=0):    cueDy=${s0._meta.cueDy.toFixed(4)}m  objDy=${s0._meta.objDy.toFixed(4)}m`);
console.log(`  trial 1 (topspin):   cueDy=${sTop._meta.cueDy.toFixed(4)}m  objDy=${sTop._meta.objDy.toFixed(4)}m`);
console.log(`  v0 vs v2 差异: cueDy ${sTop._meta.cueDy.toFixed(4)}m > v0 ${s0._meta.cueDy.toFixed(4)}m`);
