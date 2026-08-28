/**
 * 提示词工程单点（docs/hand-model.md §6 / M4 反馈规范化的载体）
 *
 * 三类输出的模板与渲染函数集中于此：
 *   - system：任务与坐标系约定（含 ghost-ball 方法论，单点演进）
 *   - observe：观察 JSON 渲染（AgentView 白名单字段）
 *   - feedback：结果反馈（球手可读语言；绝不含 optimal/bias —— 泄漏红线）
 *
 * 修改任何文案 = 修改实验变量，需在日志 meta 记录 promptVersion。
 */

export const PROMPT_VERSION = "v5";

export const SYSTEM_PROMPT = `你是一个台球 AI Agent，参加一项"校准挑战赛"。每一杆都要进球。

## 台面（美式 7 尺台，单位米）
- 宽 1.9812（x 轴，向右为正），高 0.9906（y 轴，**向下为正**）。原点在台面左上角（俯视）。
- 袋口 6 个，观察 JSON 的 pockets 给出精确坐标：lt 左上 / rt 右上 / lb 左下 / rb 右下 / ct 上边中点 / cb 下边中点。
- 球直径 5.7cm（半径 R=0.0286m）。进球判定：球心进入袋口判定圆。

## 出杆参数
- angle：出杆方向角，单位度，浮点（可以带小数）。
  angle = atan2(-(targetY - cueY), targetX - cueX) × 180/π。
  直觉：angle=0 朝右；angle=90 朝屏幕上方（y 减小）；angle=-90 朝屏幕下方；angle=180 朝左。
- power：[0,1]。0.05 轻推，0.5 中速，1.0 满力。中短距离 0.3~0.5 通常足够。

## 瞄准方法（务必按步骤计算，不要目测）
1. 先算进球方向单位向量：u = normalize(pocketPos - objPos)（沿袋心指向目标球）。
2. ghost 位（母球撞点）：ghost = objPos + u × (-2R)（即目标球背离袋口方向一个球径）。
3. 出杆方向 = ghost - cuePos；angle = atan2(-(ghostY - cueY), ghostX - cueX) × 180/π。
   注意两件事：y 用负号（屏幕系 y 向下）；是打到 ghost，不是直接打向目标球球心或袋心。

## 会话规则
- 每杆会给你：观察 JSON（含 pockets、targetPocket、两球坐标）与上一杆结果反馈。
- 结果反馈里若指出"横向偏左/偏右 N 球径"，说明你的瞄准存在系统性偏差——请按该方向**反向修正**下一杆的 angle（经验上每球径 ≈ 0.2°~1°，视距离而定）。
- 反馈信息只描述结果；请自行推断并保持修正的连续性。

## 输出格式（必须严格遵守）
只输出一行 JSON，无其它文字、无 Markdown：
{"angle": <number>, "power": <number>}`;

/** 观察 JSON 渲染（AgentView 白名单字段直传） */
export function renderObserve(obs: {
  trial: number;
  trialCount: number;
  score: number;
  targetPocket: string;
  balls: Array<{ id: string; x: number; y: number }>;
  pockets: Array<{ id: string; x: number; y: number }>;
}): string {
  return JSON.stringify(obs);
}

/** 出杆请求（user 消息模板） */
export function renderShotRequest(
  obs: {
    trial: number;
    trialCount: number;
    score: number;
    targetPocket: string;
    balls: Array<{ id: string; x: number; y: number }>;
    pockets: Array<{ id: string; x: number; y: number }>;
  },
  pendingFeedback: string | null,
): string {
  const head = pendingFeedback ? `${pendingFeedback}\n\n` : "";
  const cue = obs.balls.find((b) => b.id === "cue");
  const obj = obs.balls.find((b) => b.id !== "cue");
  return [
    `${head}第 ${obs.trial + 1}/${obs.trialCount} 杆。当前比分 ${obs.score}。`,
    `目标袋：${obs.targetPocket}`,
    cue && obj
      ? `母球 (${cue.x.toFixed(4)}, ${cue.y.toFixed(4)})；目标球 (${obj.x.toFixed(4)}, ${obj.y.toFixed(4)})。`
      : "",
    "按瞄准方法计算 angle 与 power，只输出一行 JSON。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 结果反馈（球手可读；AgentView 合规——不含 optimal/bias/任何内部量） */
export function renderFeedback(
  potted: boolean,
  pottedPocket: string | null,
  finalBalls: Array<{ id: string; x: number; y: number }>,
  missDesc: string | null,
): string {
  if (potted) return `上一杆结果：进袋（${pottedPocket}）。继续保持。`;
  const obj = finalBalls.find((b) => b.id !== "cue");
  return `上一杆结果：未进${missDesc ? `（${missDesc}）` : ""}。目标球终点 (${obj?.x.toFixed(3) ?? "?"}, ${obj?.y.toFixed(3) ?? "?"})。`;
}
