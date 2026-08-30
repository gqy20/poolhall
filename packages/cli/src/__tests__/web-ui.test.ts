import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { encodeMatchEvent, MATCH_EVENT_SCHEMA, type MatchEvent } from "@poolhall/core";
import { describe, expect, it } from "vitest";
import { renderMatchReplay } from "../web-replay.ts";

describe("实时对局前端", () => {
  it("内联脚本语法有效", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(join(here, "../../../../experiments/web/index.html"), "utf8");
    const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!source) throw new Error("未找到内联脚本");
    expect(() => new Script(source)).not.toThrow();
    expect(source).toContain('3: "#C83F3F"');
    expect(source).toContain('class: "cue-stick"');
    expect(source).toContain('"data-ball-kind"');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain('class: "motion-tail"');
    expect(source).toContain("scene.balls.get(id)");
    expect(source).not.toContain("tableFrame.innerHTML");
    expect(html).toContain('id="new-match"');
    expect(html).toContain('id="pause-playback"');
    expect(html).toContain('id="max-shots"');
    expect(html).toContain('id="fullscreen-table"');
    expect(source).toContain('type: "new_match"');
    expect(html).toContain('id="ai-plan-title"');
    expect(html).toContain('id="plan-observation"');
    expect(html).toContain('id="plan-review"');
    expect(source).toContain("renderPublicPlan");
    expect(source).toContain("logEl.prepend(div)");
    expect(html).toContain("overflow: hidden; background: var(--bg)");
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
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
