#!/usr/bin/env node
import { biasAtShot, CalibSession, CORE_VERSION } from "@poolhall/core";
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
import { type RunOpts, runCalibrate } from "./experiment.ts";
import { versionBanner } from "./index.ts";
import { configFromEnv } from "./llm.ts";
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
      const nums = (xy ?? "0,0").split(",").map(Number);
      const x = nums[0] ?? 0;
      const y = nums[1] ?? 0;
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

const parseSeeds = (s: string): number[] =>
  s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Number.isFinite);

program
  .command("experiment")
  .description("校准挑战实验（M3：合成 agent 验机 / LLM 真模型）")
  .command("calibrate")
  .description("跑校准挑战（docs/benchmark.md）")
  .requiredOption("--agent <spec>", "synthetic:oracle|no-comp|random 或 llm")
  .option("--agent-name <name>", "身份名（默认取 spec）")
  .option("--seeds <list>", "逗号分隔种子", "42")
  .option("--trials <n>", "每局杆数", "20")
  .option("--bias0", "对照组：消除身份 bias", false)
  .option("--bias-set <deg>", "强制注入指定 bias（度，正右偏）")
  .option("--out <file>", "研究日志 JSONL 输出", "experiments/results/calib.jsonl")
  .action(
    async (opts: {
      agent: string;
      agentName?: string;
      seeds: string;
      trials: string;
      bias0: boolean;
      biasSet?: string;
      out: string;
    }) => {
      const seeds = parseSeeds(opts.seeds);
      const trials = Number(opts.trials);
      for (const seed of seeds) {
        const o: RunOpts = {
          agent: opts.agent,
          agentName: opts.agentName ?? opts.agent.replaceAll(":", "-"),
          seed,
          trials,
          biasOverride: opts.bias0
            ? 0
            : opts.biasSet !== undefined
              ? Number(opts.biasSet)
              : undefined,
          out: opts.out,
        };
        const r = await runCalibrate(o);
        console.log(`seed=${seed} ${o.agentName}: ${r.score}/${r.trials} → ${r.log}`);
      }
    },
  );

program
  .command("mcp")
  .description("启动 MCP server（stdio，供 Claude Code / pi / Codex 等 MCP 客户端接入）")
  .option("--seed <n>", "server 种子", "42")
  .option("--trials <n>", "每局杆数", "20")
  .option("--agent <name>", "agent 身份名（跨局肌肉记忆）", "default")
  .option("--bias-set <deg>", "强制注入指定 bias（度，直测协议用）")
  .option("--bias0", "对照组：消除身份 bias", false)
  .option("--out <file>", "研究日志 JSONL（含完整轨迹）", "")
  .action(
    async (opts: {
      seed: string;
      trials: string;
      agent: string;
      biasSet?: string;
      bias0: boolean;
      out: string;
    }) => {
      const { startStdio } = await import("@poolhall/mcp");
      console.error(
        `poolhall MCP server 启动：agent=${opts.agent} seed=${opts.seed} trials=${opts.trials}`,
      );
      await startStdio({
        seed: Number(opts.seed),
        trials: Number(opts.trials),
        agent: opts.agent,
        biasOverride: opts.bias0 ? 0 : opts.biasSet ? Number(opts.biasSet) : undefined,
        out: opts.out || undefined,
      });
    },
  );

program
  .command("llm-ping")
  .description("LLM 连通性自测（读 .env 的 ANTHROPIC_*）")
  .action(async () => {
    const cfg = configFromEnv();
    console.log(`base=${cfg.baseUrl} model=${cfg.model} key=${cfg.apiKey ? "***" : "缺失"}`);
    if (!cfg.apiKey) {
      console.error("缺少 ANTHROPIC_AUTH_TOKEN（检查 .env）");
      process.exit(1);
    }
    const { LlmAgentSession } = await import("./llm.ts");
    const s = new LlmAgentSession(cfg);
    const shot = await s.shot({
      kind: "observe",
      trial: 0,
      trialCount: 1,
      score: 0,
      targetPocket: "rt",
      balls: [
        { id: "cue", x: 1.2, y: 0.4953 },
        { id: "1", x: 1.5, y: 0.4953 },
      ],
      pockets: [
        { id: "lt", x: 0, y: 0 },
        { id: "rt", x: 1.9812, y: 0 },
        { id: "lb", x: 0, y: 0.9906 },
        { id: "rb", x: 1.9812, y: 0.9906 },
        { id: "ct", x: 0.9906, y: 0 },
        { id: "cb", x: 0.9906, y: 0.9906 },
      ],
    });
    console.log(`自测出杆（cue(1.2,0.5)→1(1.5,0.5)→rt：正解 angle≈0）：${JSON.stringify(shot)}`);
  });

program
  .command("debug")
  .description("research 视图专用（绝不可能用于 Agent 输入，docs/hand-model.md §6）")
  .addCommand(
    new Command("hand")
      .description("查看某 agent 的隐藏手感参数（跨局记忆 + 本局特性）")
      .requiredOption("--agent <name>", "agent 身份名")
      .option("--seed <n>", "server 种子", "42")
      .option("--trials <n>", "预演杆数", "20")
      .action((opts: { agent: string; seed: string; trials: string }) => {
        const seed = Number(opts.seed);
        const session = new CalibSession({
          seed,
          agent: opts.agent,
          trialCount: Number(opts.trials),
        });
        const h = session.hand;
        console.log(`agent: ${opts.agent}  server_seed: ${seed}`);
        console.log(`  bias_base  = ${h.biasBase.toFixed(4)}°  （身份偏差，跨局稳定）`);
        console.log(`  angle_σ    = ${h.angleSigma.toFixed(4)}°`);
        console.log(`  power_σ    = ${h.powerSigma.toFixed(4)}`);
        console.log(`  drift      = κ=${h.driftKappa} σ=${h.driftSigma}°`);
        // 预演若干杆的漂移轨迹（research 用途）
        const rows: string[] = [];
        for (let k = 0; k <= Math.min(10, Number(opts.trials)); k++) {
          rows.push(
            `    b(${String(k).padStart(2)}) = ${biasAtShot(h, k, seed, opts.agent).toFixed(4)}°`,
          );
        }
        console.log("  bias 漂移轨迹（OU 闭式）:");
        console.log(rows.join("\n"));
      }),
  );

// 清台挑战（M6）：挂到 experiment 命令下 —— experiment clear
const expCmd = program.commands.find((c) => c.name() === "experiment");
expCmd
  ?.command("clear")
  .description("清台挑战实验（9 球计分赛，30 杆预算）")
  .requiredOption("--agent <spec>", "synthetic:oracle 或 llm")
  .option("--agent-name <name>", "身份名（默认取 spec）")
  .option("--seeds <list>", "逗号分隔种子", "42")
  .option("--max-shots <n>", "杆数预算", "30")
  .option("--bias0", "对照组：消除身份 bias", false)
  .option("--out <file>", "研究日志 JSONL", "experiments/results/clear.jsonl")
  .action(
    async (opts: {
      agent: string;
      agentName?: string;
      seeds: string;
      maxShots: string;
      bias0: boolean;
      out: string;
    }) => {
      const { runClear } = await import("./clear-run.ts");
      for (const seed of parseSeeds(opts.seeds)) {
        const r = await runClear({
          agent: opts.agent,
          agentName: opts.agentName ?? opts.agent.replaceAll(":", "-"),
          seed,
          maxShots: Number(opts.maxShots),
          biasOverride: opts.bias0 ? 0 : undefined,
          out: opts.out,
        });
        console.log(
          `seed=${seed} ${r.agentName}: ${r.potted}/${r.total} 杆${r.shots}` +
            `${r.scratches > 0 ? ` scratch×${r.scratches}` : ""}${r.cleared ? " 🏆清台" : ""} → ${opts.out}`,
        );
      }
    },
  );

program
  .command("debug-go")
  .description("generateObject 稳定性调试（直接对真实 API 跑 N 次）")
  .argument("[n]", "调用次数", "50")
  .action(async (nArg: string) => {
    const { runDebugGo } = await import("./debug-go.ts");
    await runDebugGo(Number(nArg));
  });

void CORE_VERSION;
void ENGINE_VERSION;
void SEVEN_FOOT;
program.parseAsync();
