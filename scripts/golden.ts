/**
 * golden 对拍导出（CI 用：`node scripts/golden.ts` 生成 → tests/golden.test.ts 比对）
 *
 * 用法：
 *   node scripts/golden.ts            # 生成/更新 packages/engine/src/__tests__/golden/scenes.json
 *   node scripts/golden.ts --check    # 只校验不写（CI 模式，漂移即退出 1）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Ball,
  buildTable,
  DEFAULT_BALL,
  makeBall,
  serializeTrajectory,
  simulate,
  strike,
  vec2,
} from "../packages/engine/src/index.ts";

interface GoldenCase {
  name: string;
  desc: string;
  /** 初始球位（未含速度）与出杆参数 */
  setup: {
    balls: Array<{ id: string; x: number; y: number }>;
    shot: { angle: number; power: number };
  };
  /** 期望终态（确定性强断言） */
  expect: {
    stopReason: string;
    simTime: number;
    finals: Array<{ id: string; x: number; y: number; pocketed: boolean; pocket: string | null }>;
    events: Array<{
      t: number;
      kind: string;
      a: string;
      b?: string;
      cushion?: string;
      pocket?: string;
    }>;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "engine", "src", "__tests__", "golden");
const outFile = join(outDir, "scenes.json");

const table = buildTable();
const p = DEFAULT_BALL;

// 与 cli/src/scenes.ts 同源的五场景（engine 不能 import cli，此处独立维护）
const scenes: Array<{ name: string; desc: string; make: () => Ball[] }> = [
  {
    name: "straight",
    desc: "直线球",
    make: () => {
      const cue = makeBall("cue", vec2(0.5, 0.5));
      const one = makeBall("1", vec2(1.2, 0.5));
      strike(cue, 0, 0.5);
      return [cue, one];
    },
  },
  {
    name: "cut",
    desc: "切角球",
    make: () => {
      const cue = makeBall("cue", vec2(0.6, 0.5));
      const one = makeBall("1", vec2(1.3, 0.4));
      strike(cue, 6.5, 0.5);
      return [cue, one];
    },
  },
  {
    name: "cushion",
    desc: "吃库反弹",
    make: () => {
      const cue = makeBall("cue", vec2(0.5, 0.3));
      strike(cue, 90, 0.4);
      return [cue];
    },
  },
  {
    name: "pot",
    desc: "直线进袋",
    make: () => {
      const cue = makeBall("cue", vec2(1.7, 0.75));
      strike(cue, (Math.atan2(0.75, 1.7) * 180) / Math.PI, 0.5);
      return [cue];
    },
  },
  {
    name: "combo",
    desc: "三球组合",
    make: () => {
      const cue = makeBall("cue", vec2(0.4, 0.5));
      const one = makeBall("1", vec2(0.9, 0.5));
      const two = makeBall("2", vec2(1.4, 0.5));
      strike(cue, 0, 0.7);
      return [cue, one, two];
    },
  },
];

const run = (): GoldenCase[] =>
  scenes.map((sc) => {
    const balls = sc.make();
    const setup = {
      balls: balls.map((b) => ({ id: b.id, x: +b.pos.x.toFixed(6), y: +b.pos.y.toFixed(6) })),
      shot: { angle: balls[0] ? readShotAngle(balls) : 0, power: readPower(balls) },
    };
    const r = simulate(balls, table, p);
    return {
      name: sc.name,
      desc: sc.desc,
      setup: { balls: setup.balls, shot: setup.shot },
      expect: {
        stopReason: r.stopReason,
        simTime: +r.simTime.toFixed(6),
        finals: r.balls.map((b) => ({
          id: b.id,
          x: +b.pos.x.toFixed(6),
          y: +b.pos.y.toFixed(6),
          pocketed: b.pocketed,
          pocket: b.pocket ?? null,
        })),
        events: r.events.map((e) => ({
          t: +e.t.toFixed(6),
          kind: e.kind,
          a: e.a,
          ...(e.b !== undefined ? { b: e.b } : {}),
          ...(e.cushion !== undefined ? { cushion: e.cushion } : {}),
          ...(e.pocket !== undefined ? { pocket: e.pocket } : {}),
        })),
      },
    };
  });

/** 从已 strike 的球里读出杆参数——golden 场景单独存原始值更干净，此处直接内联 */
function readShotAngle(balls: Ball[]): number {
  const cue = balls[0]!;
  const speed = Math.hypot(cue.vel.x, cue.vel.y);
  if (speed < 1e-9) return 0;
  return +((Math.atan2(-cue.vel.y, cue.vel.x) * 180) / Math.PI).toFixed(6);
}
function readPower(balls: Ball[]): number {
  const cue = balls[0]!;
  const speed = Math.hypot(cue.vel.x, cue.vel.y);
  return +((speed - 0.5) / 7.5).toFixed(6);
}

const check = process.argv.includes("--check");
const cases = run();

if (check) {
  if (!existsSync(outFile)) {
    console.error("golden 文件不存在，先运行生成模式");
    process.exit(1);
  }
  const golden = JSON.parse(readFileSync(outFile, "utf-8")) as GoldenCase[];
  const a = JSON.stringify(golden, null, 2);
  const b = JSON.stringify(cases, null, 2);
  if (a !== b) {
    console.error("✗ golden 漂移！物理行为发生变化，需人工确认后重新生成：");
    console.error("  node scripts/golden.ts");
    process.exit(1);
  }
  console.log(`✓ golden 一致（${cases.length} 场景）`);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`✓ 已生成 ${outFile}（${cases.length} 场景）`);
  console.log("确认物理行为符合预期后提交入库。");
}

void serializeTrajectory;
