#!/usr/bin/env node
import { CORE_VERSION } from "@poolhall/core";
import {
  type Ball,
  buildTable,
  DEFAULT_BALL,
  ENGINE_VERSION,
  makeBall,
  SEVEN_FOOT,
  serializeTrajectory,
  simulate,
  solvePotPocket,
  type Vec2,
  vec2,
} from "@poolhall/engine";
/**
 * poolhall CLI 入口（docs/cli.md 命令面）
 * M1 提供：demo / render / trace / solve；play/run/replay/experiment M2/M3 接入。
 */
import { Command } from "commander";
import { versionBanner } from "./index.ts";
import { renderTable, renderTrace } from "./render.ts";
import { demoScenes } from "./scenes.ts";

const table = buildTable();
const p = DEFAULT_BALL;

const program = new Command();
program
  .name("poolhall")
  .description("PoolHall · 让每个 AI 智能体拥有一双不完美的手")
  .version(versionBanner())
  .option("--seed <n>", "随机种子（默认 42）", "42");

program
  .command("demo")
  .description("演示场景一杆（默认 straight）")
  .option("-s, --scene <name>", `场景名: ${demoScenes.map((s) => s.name).join("/")}`, "straight")
  .option("--trail", "叠加尾迹", false)
  .action((opts: { scene: string; trail: boolean }) => {
    const scene = demoScenes.find((s) => s.name === opts.scene);
    if (!scene) {
      console.error(`未知场景 "${opts.scene}"，可用: ${demoScenes.map((s) => s.name).join(", ")}`);
      process.exit(1);
    }
    const balls = scene.setup();
    const r = simulate(balls, table, p);
    console.log(`场景: ${scene.name} — ${scene.desc}`);
    console.log(renderTable(r.balls, table, opts.trail ? { trail: r.samples } : {}));
    console.log(
      `events: ${r.events.map((e) => `${e.kind}(${e.a}${e.b ? `-${e.b}` : ""}${e.pocket ? `→${e.pocket}` : ""})`).join(", ") || "无"}`,
    );
    console.log(`simTime: ${r.simTime.toFixed(2)}s, stop: ${r.stopReason}`);
  });

program
  .command("render")
  .description("ASCII 渲染球桌（--balls cue:x,y;obj:x,y[;...]）")
  .option("-b, --balls <spec>", "球位 spec，如 cue:0.5,0.5;1:1.2,0.4", "cue:0.5,0.5;1:1.2,0.4")
  .action((opts: { balls: string }) => {
    const balls: Ball[] = [];
    for (const part of opts.balls.split(";")) {
      const [id, xy] = part.split(":");
      const [x, y] = (xy ?? "0,0").split(",").map(Number);
      if (id && Number.isFinite(x) && Number.isFinite(y)) {
        balls.push(makeBall(id, vec2(x, y)));
      }
    }
    console.log(renderTable(balls, table));
  });

program
  .command("trace")
  .description("逐帧轨迹（默认直线球演示）")
  .option("-s, --scene <name>", "场景名", "straight")
  .action((opts: { scene: string }) => {
    const scene = demoScenes.find((s) => s.name === opts.scene) ?? demoScenes[0]!;
    const r = simulate(scene.setup(), table, p);
    console.log(renderTrace(r.samples, r.events, table));
    console.log(`\nsimTime: ${r.simTime.toFixed(2)}s, stop: ${r.stopReason}`);
  });

program
  .command("solve")
  .description("最优角求解（research 用，勿给 Agent）")
  .requiredOption("--cue <xy>", "母球位，如 0.5,0.5")
  .requiredOption("--obj <xy>", "目标球位")
  .requiredOption("--pocket <id>", "袋口 id：lt/rt/lb/rb/ct/cb")
  .action((opts: { cue: string; obj: string; pocket: string }) => {
    const parse = (s: string): Vec2 => {
      const [x, y] = s.split(",").map(Number);
      return vec2(x ?? 0, y ?? 0);
    };
    const ang = solvePotPocket(parse(opts.cue), parse(opts.obj), opts.pocket, table, p.R);
    if (ang === null) {
      console.error("几何不可行");
      process.exit(3);
    }
    console.log(`angle = ${ang.toFixed(3)}°`);
  });

program
  .command("hash")
  .description("轨迹哈希原料（确定性验证工具）")
  .option("-s, --scene <name>", "场景名", "straight")
  .action((opts: { scene: string }) => {
    const scene = demoScenes.find((s) => s.name === opts.scene) ?? demoScenes[0]!;
    const r = simulate(scene.setup(), table, p);
    const serialized = serializeTrajectory(r);
    // FNV-1a（engine 不能引 crypto；cli 可以，但为保持工具简单用 FNV）
    let h = 0x811c9dc5;
    for (let i = 0; i < serialized.length; i++) {
      h ^= serialized.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    console.log(`fnv1a32 = ${h.toString(16).padStart(8, "0")}`);
    console.log(`bytes = ${serialized.length}`);
  });

void CORE_VERSION;
void ENGINE_VERSION;
void SEVEN_FOOT;
program.parseAsync();
