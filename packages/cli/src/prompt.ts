/**
 * 提示词资产加载与渲染单点（prompts/<task>.yaml，按任务分文件）
 *
 * 版本管理约定：git 管 diff；研究日志 meta 记录 version 字段 + 内容 SHA-256
 * （谁改了哪个字，日志的 fingerprint 能对回来）。
 * 分工：yaml = 文案；本文件 = 组合逻辑（账本循环/条件分支/插值）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

export interface LedgerRow {
  trial: number;
  aim: { x: number; y: number };
  angleUsed: number;
  spinUsed: { x: number; y: number; z: number } | null;
  potted: boolean;
  pottedPocket: string | null;
  sideNote: string | null;
}

/** 任务类型 → 提示词文件（按任务分文件管理；每文件独立版本） */
export type PromptTask = "calibrate" | "clear" | "match";

interface PromptAsset {
  version: string;
  system: string;
  templates: {
    shot_request: string;
    reprompt_unparseable?: string;
    feedback_potted: string;
    feedback_miss: string;
    feedback_scratch?: string;
  };
  ledger: { keep: number; header: string; footer: string; row: string };
}

function assetFile(task: PromptTask): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, `../../../prompts/${task}.yaml`);
}

const cache = new Map<PromptTask, PromptAsset>();

const ensureLoaded = (task: PromptTask): PromptAsset => {
  const hit = cache.get(task);
  if (hit) return hit;
  const file = assetFile(task);
  if (!existsSync(file)) {
    throw new Error(`prompts/${task}.yaml 不存在——提示词资产缺失（应位于仓库根 prompts/）`);
  }
  const text = readFileSync(file, "utf-8");
  const parsed = loadYaml(text) as PromptAsset;
  if (!parsed?.version || !parsed?.system || !parsed?.templates || !parsed?.ledger) {
    throw new Error(`prompts/${task}.yaml 缺 version/system/templates/ledger 字段`);
  }
  cache.set(task, parsed);
  return parsed;
};

/** 实验结果锚定：version + 内容哈希（进研究日志 meta） */
export function promptFingerprint(task: PromptTask = "calibrate"): {
  version: string;
  file: string;
  sha256: string;
} {
  ensureLoaded(task);
  const abs = assetFile(task);
  return {
    version: ensureLoaded(task).version,
    file: relative(process.cwd(), abs) || abs,
    sha256: createHash("sha256").update(readFileSync(abs, "utf-8")).digest("hex").slice(0, 16),
  };
}

/** system 全文（会话 system 消息） */
export function systemPrompt(task: PromptTask = "calibrate"): string {
  return ensureLoaded(task).system;
}

/** 出杆请求：观察 + 挂起反馈 + 账本按模板拼装（通用模板变量按需替换，缺省占位不报错） */
export function renderShotRequest(
  obs: {
    trial: number;
    trialCount?: number;
    score?: number;
    total?: number;
    remaining?: number;
    targetPocket?: string;
    balls: Array<{ id: string; x: number; y: number }>;
    pockets?: Array<{ id: string; x: number; y: number }>;
    aimAssist?: unknown;
    aimAssists?: unknown;
  },
  pendingFeedback: string | null,
  ledger: LedgerRow[],
  task: PromptTask = "calibrate",
): string {
  const a = ensureLoaded(task);
  const cue = obs.balls.find((b) => b.id === "cue");
  const obj = obs.balls.find((b) => b.id !== "cue");
  return a.templates.shot_request
    .replace("{pending_feedback}", pendingFeedback ?? "")
    .replace("{shot_ledger}", renderLedgerBlock(ledger.slice(-a.ledger.keep), task))
    .replace(
      "{trial}",
      obs.trialCount ? `${obs.trial + 1}/${obs.trialCount}` : String(obs.trial + 1),
    )
    .replace("{score}", String(obs.score ?? 0))
    .replace("{total}", String(obs.total ?? 9))
    .replace("{remaining}", String(obs.remaining ?? 9))
    .replace("{observation}", JSON.stringify(obs))
    .replace("{target_pocket}", String(obs.targetPocket ?? ""))
    .replace("{cue_x}", cue ? cue.x.toFixed(4) : "?")
    .replace("{cue_y}", cue ? cue.y.toFixed(4) : "?")
    .replace("{obj_x}", obj ? obj.x.toFixed(4) : "?")
    .replace("{obj_y}", obj ? obj.y.toFixed(4) : "?");
}

/** 结果反馈（球手可读；AgentView 合规——不含 optimal/bias） */
export function renderFeedback(
  potted: boolean,
  pottedPocket: string | null,
  finalBalls: Array<{ id: string; x: number; y: number }>,
  missDesc: string | null,
  task: PromptTask = "calibrate",
): string {
  const a = ensureLoaded(task);
  if (potted) return a.templates.feedback_potted.replaceAll("{pocket}", pottedPocket ?? "");
  const obj = finalBalls.find((b) => b.id !== "cue");
  return a.templates.feedback_miss
    .replace("{miss_desc}", missDesc ?? "无进一步信息")
    .replace("{final_x}", obj ? obj.x.toFixed(3) : "?")
    .replace("{final_y}", obj ? obj.y.toFixed(3) : "?");
}

/** 账本块（最近 keep 杆，回忆载体） */
export function renderLedgerBlock(rows: LedgerRow[], task: PromptTask = "calibrate"): string {
  const a = ensureLoaded(task);
  if (rows.length === 0) return "";
  const lines = rows.slice(-a.ledger.keep).map((r) =>
    a.ledger.row
      .replace("{trial}", String(r.trial + 1))
      .replace("{aim}", `(${r.aim.x.toFixed(3)}, ${r.aim.y.toFixed(3)})`)
      .replace(
        "{spin}",
        r.spinUsed
          ? `[${r.spinUsed.x.toFixed(2)},${r.spinUsed.y.toFixed(2)},${r.spinUsed.z.toFixed(2)}]`
          : "[0,0,0]",
      )
      .replace("{angle}", r.angleUsed.toFixed(2))
      .replace(
        "{outcome}",
        r.potted ? `进袋(${r.pottedPocket})` : `未进${r.sideNote ? `，${r.sideNote}` : ""}`,
      ),
  );
  return `${a.ledger.header}\n${lines.join("\n")}\n${a.ledger.footer}`;
}

export function repromptUnparseable(task: PromptTask = "calibrate"): string {
  return ensureLoaded(task).templates.reprompt_unparseable ?? "";
}
