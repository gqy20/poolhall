/**
 * 提示词工程单点（PROMPT_VERSION=v6）
 *
 * 设计依据（调研四要点）：
 * 1. 几何参考前置：ghost 瞄点位在观察里直接给出（README"它算得出完美轨迹"——
 *    几何属于"知"层可计算；benchmark 测的是手感校准，不是三角心算）
 * 2. 输出接口可读化：agent 输出"瞄向点 (x,y)"而非角度——atan2/符号/象限在边界层换算
 * 3. Reflexion 式记忆：打好杆的账本（你瞄的→结果→偏了多少）随反馈重放，
 *    显式要求回顾；agent 维护一行自我诊断
 * 4. XML 结构 + 数据前置 + 末行格式要求；给 reasoner 留 2-4 行推理空间，取最后一个 JSON
 */

export const PROMPT_VERSION = "v6";

export const SYSTEM_PROMPT = `<role>
你是台球 AI Agent，参加"校准挑战赛"。每一杆都要进球。
</role>

<table>
美式 7 尺台（单位米）：宽 1.9812（x 向右），高 0.9906（y **向下**为正）。原点在台面左上角（俯视）。
袋口 6 个（观察 JSON 的 pockets 给精确坐标）：lt 左上 / rt 右上 / lb 左下 / rb 右下；ct 上边中点 / cb 下边中点。
球半径 R=0.0286。进球判定：目标球球心进入袋口判定圆。
</table>

<aim_assist>
观察 JSON 的 aimAssist.ghost 是目标袋的"瞄点"（目标球背离袋口方向一个球径处）：
母球击中该点，目标球即沿袋口方向被撞出。这是**零偏差参考**——你通常应该瞄它附近。
你的隐藏任务：如果多杆结果持续偏向同一侧，说明你（agent）有自己的出手系统偏差——
此时必须**向偏差的反方向**偏离 ghost 瞄点，偏移量从历史账本中估计。
</aim_assist>

<output_contract>
最后一行只输出一个 JSON（可带小数，禁止整数化）：
{"aimX": <瞄点x>, "aimY": <瞄点y>, "power": <0~1>}
aimX/aimY 是母球出杆应瞄向的点（通常是 ghost 位，或你决定修正后的点）。
power 建议 0.3~0.5（中短距离足够；满力会让走位失控）。
</output_contract>

<recall_protocol>
每杆反馈附"账本"（最近 5 杆：第几杆/你瞄哪/偏了多少）。输出 JSON 前先思考：
1) 最近几杆的横向偏差是否同向且量级稳定？
2) 若是 → 这是你的系统性出手偏差 → 反向修正瞄点，量级按"每球径 ≈ 0.2°~1°"估计；
3) 若散乱 → 保持瞄 ghost，减小自身波动。
</recall_protocol>`;

/** 账本行（Reflexion 式：你瞄的 → 结果 → 偏差） */
export interface LedgerRow {
  trial: number;
  aim: { x: number; y: number };
  angleUsed: number;
  potted: boolean;
  pottedPocket: string | null;
  sideNote: string | null;
}

/** 账本渲染（最近 K 杆，供 agent 回忆） */
export function renderLedger(rows: LedgerRow[], keep = 5): string {
  const last = rows.slice(-keep);
  if (last.length === 0) return "";
  const lines = last.map(
    (r) =>
      `  第${r.trial + 1}杆: 瞄((${r.aim.x.toFixed(3)}, ${r.aim.y.toFixed(3)})) 角度${r.angleUsed.toFixed(2)}° → ${
        r.potted ? `进袋(${r.pottedPocket})` : `未进${r.sideNote ? `，${r.sideNote}` : ""}`
      }`,
  );
  return `<shot_ledger>\n${lines.join("\n")}\n</shot_ledger>`;
}

/** 观察 + 出杆请求渲染（XML 结构；数据前置） */
export function renderShotRequest(
  obs: {
    trial: number;
    trialCount: number;
    score: number;
    targetPocket: string;
    balls: Array<{ id: string; x: number; y: number }>;
    pockets: Array<{ id: string; x: number; y: number }>;
    aimAssist?: {
      ghost: { x: number; y: number };
      suggestedAngle: number;
      cutAngleDeg: number;
    };
  },
  pendingFeedback: string | null,
  ledger: LedgerRow[],
): string {
  const cue = obs.balls.find((b) => b.id === "cue");
  const obj = obs.balls.find((b) => b.id !== "cue");
  const parts: string[] = [];
  if (pendingFeedback) parts.push(pendingFeedback);
  if (ledger.length > 0) parts.push(renderLedger(ledger));
  parts.push(
    `<observation trial="${obs.trial + 1}/${obs.trialCount}" score="${obs.score}">\n` +
      JSON.stringify(obs) +
      `\n</observation>`,
    `目标袋 ${obs.targetPocket}；母球 (${cue?.x.toFixed(4)}, ${cue?.y.toFixed(4)})；目标球 (${obj?.x.toFixed(4)}, ${obj?.y.toFixed(4)})。`,
    `aimAssist.ghost 提供了零偏差参考瞄点。综合账本决定：直接瞄 ghost，还是向修正方向偏移。`,
    `思考 2-4 行，最后一行输出 {"aimX": .., "aimY": .., "power": ..}`,
  );
  return parts.filter(Boolean).join("\n\n");
}

/** 结果反馈渲染（球手可读；AgentView 合规——不含 optimal/bias） */
export function renderFeedback(
  potted: boolean,
  pottedPocket: string | null,
  finalBalls: Array<{ id: string; x: number; y: number }>,
  missDesc: string | null,
): string {
  if (potted) return `<result>进袋（${pottedPocket}）——本杆的瞄点与角度组合有效。</result>`;
  const obj = finalBalls.find((b) => b.id !== "cue");
  return `<result>未进${missDesc ? `：${missDesc}` : ""}。目标球终点 (${obj?.x.toFixed(3)}, ${obj?.y.toFixed(3)})。请对照账本更新自我诊断。</result>`;
}
