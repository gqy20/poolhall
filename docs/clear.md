# 清台挑战 · clear

状态：已定稿（2026-08-29，M6.1 首版）

## 1. 规则（v1 简化 9 球，非标准）

- 9 颗彩球**菱形摆位**（1-2-3-2-1，1 朝母球；seed 微扰防完美对称）+ 母球开球位
- 任意球进任意袋有效；**计分赛制**：固定杆数预算（默认 30）内最大化进球数
- 未进只是浪费一杆（不终局——开球 miss 一杆终局会让开局变掷硬币，已废弃该规则）
- **母球进袋（scratch）= 立即终局** + 犯规计数（强威慑；防 scratch = 走位/spin 的用武之地）
- 终局 = 清台 | scratch | 预算耗尽
- 手感噪声与校准挑战同源（同一 hand model，applyHand 注入）

## 2. 观察与辅助

- 观察：球位（剩余球）、六袋坐标、进度、**aimAssists**（每颗剩余球最容易球-袋组合的
  ghost 瞄点 + 切角）——"知"层可计算，benchmark 测"行" + 规划
- 泄漏红线同 hand-model.md §6：观察白名单无 bias/optimal/actual

## 3. 实现位置

| 层 | 文件 | 说明 |
|----|------|------|
| core | `packages/core/src/clear.ts` | ClearSession（rack/observe/shoot/scratch 判定/aimAssists） |
| cli | `packages/cli/src/clear-run.ts` | 实验执行器（oracle 验机 + LLM） |
| prompt | `prompts/clear.yaml` | 任务文案（版本 c1；与 calibrate.yaml 分文件管理） |
| schema | `packages/cli/src/llm.ts` ClearOutputSchema | targetBall/targetPocket/aim/power/spin/note |

运行：`poolhall experiment clear --agent synthetic:oracle|llm --seed 42 --out ...`

## 4. 基线（2026-08-29 首测）

| agent | seed 42/7/123/2024 | 特征 |
|-------|--------------------|------|
| oracle（贪心无走位） | 2/9, 2/9, 5/9, 6/9 | **四局全死于 scratch**——直球无低杆跟进袋，游戏难度真实 |
| LLM（MiniMax-M3, c1） | 2/9（6 杆，端点中断） | 会自选目标组合；管线通 |

关键游戏性发现：scratch 威慑让**低杆（spin.y 负）从可选技巧变成生存技能**——
v7 校准挑战里模型拒绝使用 spin 的问题，在此模式下有真实激励。

## 5. 已知问题与后置

- 端点抖动穿透 3 次重试会中断 LLM 局（与校准挑战同病）
- aimAssists 未考虑遮挡（被挡球的 ghost 仍会给出——规划深度的真实来源）
- 无 ball-in-hand（scratch 直接终局而非重新摆球）；无连续进球奖励分

## 变更记录

- 2026-08-29 首版定稿：菱形 9 球、计分赛制（未进不终局）、scratch 终局、aimAssists
