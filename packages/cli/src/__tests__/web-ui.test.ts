import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { encodeMatchEvent, MATCH_EVENT_SCHEMA, type MatchEvent } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import { renderMatchReplay } from "../web-replay.ts";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../experiments/web");

describe("实时对局前端", () => {
  it("拆分后脚本语法有效（table.js / human.js），骨架引用外部资产", async () => {
    const html = await readFile(join(webDir, "index.html"), "utf8");
    const source = await readFile(join(webDir, "table.js"), "utf8");
    const humanJs = await readFile(join(webDir, "human.js"), "utf8");
    const css = await readFile(join(webDir, "style.css"), "utf8");
    expect(() => new Script(source)).not.toThrow();
    expect(() => new Script(humanJs)).not.toThrow();
    // 骨架：无内联 script/style，外链资产（绝对路径，大厅 /table/<id> 页下才能正确解析）+ 事件嵌入标记
    expect(html).toMatch(/<link rel="stylesheet" href="\/style\.css"\s*\/?>/);
    expect(html).toContain('<script src="/table.js"></script>');
    expect(html).toContain('<script src="/human.js"></script>');
    expect(html).toContain("<!--POOLHALL_EVENTS-->");
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
    expect(html).not.toContain("<style>");
    // table.js：观战核心迁移完整性
    expect(source).toContain('3: "#C83F3F"');
    expect(source).toContain('class: "cue-stick"');
    expect(source).toContain('"data-ball-kind"');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain('class: "motion-tail"');
    expect(source).toContain("scene.balls.get(id)");
    expect(source).not.toContain("tableFrame.innerHTML");
    expect(source).toContain('type: "new_match"');
    expect(source).toContain("renderPublicPlan");
    expect(source).toContain("logEl.prepend(div)");
    expect(source).toContain('class: "aim-layer"');
    expect(source).toContain('class: "aim-pred"');
    expect(source).toContain('class: "aim-act"');
    expect(source).toContain("drawPrediction");
    expect(source).toContain("pushActual");
    expect(source).toContain("showBreakShock");
    expect(source).toContain("potFlash");
    expect(source).toContain("showScratchMock");
    expect(source).toContain("showVictory");
    expect(source).toContain("shakeTable");
    expect(source).toContain("removals");
    expect(source).toContain("globalThis.POOLHALL");
    // 场景重建必须清空球缓存（否则旧球节点脱离 DOM 被复用 → 球隐形）
    expect(source).toContain("scene.balls = new Map()");
    // human.js：人类球杆层（入座/预演/出杆）
    expect(humanJs).toContain("/match/join");
    expect(humanJs).toContain("/match/preview");
    expect(humanJs).toContain("/match/shot");
    expect(humanJs).toContain("/match/state");
    expect(humanJs).toContain("globalThis.POOLHALL");
    expect(humanJs).toContain('document.getElementById("human-fire")');
    expect(humanJs).toContain("human-path-cue");
    expect(humanJs).toContain("updateCueStick");
    // index.html：控件 id 齐全（含人类操作条）
    expect(html).toContain('id="new-match"');
    expect(html).toContain('id="pause-playback"');
    expect(html).toContain('id="max-shots"');
    expect(html).toContain('id="fullscreen-table"');
    expect(html).toContain('id="ai-plan-title"');
    expect(html).toContain('id="plan-observation"');
    expect(html).toContain('id="plan-review"');
    expect(html).toContain('id="caption"');
    expect(html).toContain('id="human-bar"');
    expect(html).toContain('id="human-name"');
    expect(html).toContain('id="human-fire"');
    expect(html).toContain('id="human-power"');
    expect(html).toContain('id="human-spin"');
    expect(html).toContain('id="human-noise"');
    // style.css：原样式迁移 + 人类层样式
    expect(css).toContain("background: var(--bg)");
    expect(css).toContain("tableShake");
    expect(css).toContain("shake-hard");
    expect(css).toContain("capPop");
    expect(css).toContain(".human-bar");
    expect(css).toContain(".human-path-cue");
    expect(css).toContain(".human-ghost");
  });

  it("公开 JSONL 可生成无网络依赖的自包含 HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poolhall-replay-"));
    const input = join(dir, "events.jsonl");
    const output = join(dir, "replay.html");
    const events: MatchEvent[] = [
      {
        type: "hello",
        schema: MATCH_EVENT_SCHEMA,
        seed: 42,
        nameA: "A<safe>",
        nameB: "B",
        promptA: null,
        promptB: null,
        table: { width: 2.54, height: 1.27, breakLineX: 0.635, footSpotX: 1.905 },
      },
      {
        type: "summary",
        schema: MATCH_EVENT_SCHEMA,
        winner: null,
        reason: "测试",
        shots: 0,
      },
    ];
    try {
      await writeFile(input, `${events.map(encodeMatchEvent).join("\n")}\n`);
      const result = renderMatchReplay(input, output);
      const html = await readFile(output, "utf8");
      expect(result).toMatchObject({ events: 2, shots: 0 });
      expect(html).toContain("globalThis.POOLHALL_EVENTS=");
      expect(html).toContain("A\\u003csafe>");
      expect(html).not.toContain("ws://");
      // 单文件回放：观战核心已内联，人类交互层不进回放
      expect(html).not.toMatch(/src="\/(table|human)\.js"/);
      expect(html).not.toMatch(/href="\/style\.css"/);
      expect(html).toContain('class: "aim-layer"');
      expect(html).toContain(".human-bar");
      expect(html).toContain("回放");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
