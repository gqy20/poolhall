# 中式八球对局 · match

状态：已定稿（2026-08-29，M6.2 首版）

## 1. 规则（v1 简化，相对完整中式八球的裁剪）

- 15 球标准三角（1 顶点、8 第三行中位、底行两角一全色一花色；seed 洗牌 + ≤0.015R 微扰）
- open table：首个**合法**进球定组（全色 1-7 / 花色 9-15）
- 轮流击打：合法进本组球继续；未进/犯规换人
- **犯规 v1 两类**：scratch（母球进袋 → 换人 + 母球重置开球点，被挡向右顺延）、
  首触错组/未清组触 8（首触从 events 首个含 cue 的 ball-ball 事件读取）
- **8 号**：本组清空后合法进 8 = 胜；提前进 8 / 打 8 时 scratch = 判负
- 预算 60 杆耗尽 = 平局
- **v1 未做**（后置）：自由球任意摆位、进对方球判罚（当前只换人）、开球 8 进袋重摆、
  无进球判犯规、双方观察/观战视角

## 2. 双选手手感

A/B 各自独立 hand model（bias 由 `hash(seed, name)` 派生）——
同名选手跨局手感记忆保留。这是"读对手 bias"心理层的地基（hand-model.md §心理层）。

## 3. 实现位置

| 层 | 文件 | 说明 |
|----|------|------|
| core | `packages/core/src/match.ts` | MatchSession（rack/定组/裁判/换手/胜负 + `continueTurn` 字段） |
| cli | `packages/cli/src/match-run.ts` | 对局执行器（oracle / llm 选手混编） |
| prompt | `prompts/match.yaml` | 对局文案（m2；含"清组才能打 8"独立条款 + 心理层钩子） |
| schema | 复用 ClearOutputSchema（llm.ts shotMatch） | 选球-袋 + 瞄点 + spin.y 低杆 + note |
| mcp | `packages/mcp/src/match-tools.ts` + `server.ts:buildPoolhallMatchMcp` | 4 工具（open/observe/shot/state），独立 stdio 入口（`poolhall-mcp --match`） |

运行：
- CLI：`poolhall experiment match --a llm --b synthetic:oracle --seed 42`
- MCP：`poolhall-mcp --match --seed 42 --name-a playerA --name-b playerB`

## 4. 基线（2026-08-29 首测）

| 对局 | 结果 | 特征 |
|------|------|------|
| oracle vs oracle（4 seed） | 合法清台胜 / 提前进 8 负 / 打 8 scratch 负 | 犯规 4-20 次/局（naive 双方互喂） |
| llm vs oracle（seed 42，12 杆） | **LLM 胜**（oracle 第 8 杆误进 8 判负） | LLM 会自选目标组合；管线全通 |

## 变更记录

- 2026-08-29 首版定稿：v1 简化规则 + 双 hand model + LLM 接入
