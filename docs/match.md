# 中式八球对局 · match

状态：已定稿（2026-08-30，M6.3 外部接入；首版 2026-08-29）

## 1. 规则（v1 简化，相对完整中式八球的裁剪）

- CBSA 中式比赛台内沿 `2.540 × 1.270m`；开球线与置球点分别位于长轴 `1/4`、`3/4`
- 15 球标准三角沿长轴摆放：1 号顶点朝开球方，8 号第三行中位，底角一全一花，球间无微扰并彼此贴紧
- 母球默认置于开球线后一个球直径、横向居中；第一杆强制使用 break 意图直击 1 号，力度 0.85
- 合法开球：有目标球进袋或至少四颗目标球碰库；开球进球后球局仍保持开放，开球进 8 时重置 8 号
- open table：首个**合法**进球定组（全色 1-7 / 花色 9-15）
- 轮流击打：合法进本组球继续；未进/犯规换人
- **犯规 v1 两类**：scratch（母球进袋 → 换人 + 母球重置开球点，被挡向右顺延）、
  首触错组/未清组触 8（首触从 events 首个含 cue 的 ball-ball 事件读取）
- **8 号**：本组清空后合法进 8 = 胜；提前进 8 / 打 8 时 scratch = 判负
- 预算 60 杆耗尽 = 平局
- **v1 未做**（后置）：自由球任意摆位、进对方球判罚（当前只换人）、
  无进球判犯规、双方观察/观战视角

## 2. 双选手手感

A/B 各自独立 hand model（bias 由 `hash(seed, name)` 派生）——
同名选手跨局手感记忆保留。这是“读对手 bias”心理层的地基（hand-model.md §心理层）。

常驻大厅模式（M6.4）用 `handSeed` 把 bias 派生与开局 seed 解耦：同一身份跨局跨桌
bias 恒定（见 docs/lobby.md §4）。

## 3. 实现位置

| 层 | 文件 | 说明 |
|----|------|------|
| core | `packages/core/src/match.ts` | MatchSession（rack/定组/裁判/换手/胜负 + `continueTurn` 字段） |
| cli | `packages/cli/src/match-run.ts` | 对局执行器（oracle / llm 选手混编） |
| prompt | `prompts/match.yaml` | 对局文案（m2；含"清组才能打 8"独立条款 + 心理层钩子） |
| schema | 复用 ClearOutputSchema（llm.ts shotMatch） | 选球-袋 + 瞄点 + spin.y 低杆 + note |
| mcp | `packages/mcp/src/match-tools.ts` + `server.ts:buildPoolhallMatchMcp` | 4 工具（open/observe/shot/state），独立 stdio 入口（`poolhall-mcp --match`） |
| mcp-remote | `packages/mcp/src/remote.ts` + `server.ts:buildPoolhallMatchRemoteMcp` | 远程入座模式：工具面不变，经 HTTP 代理到共享对局（§5） |
| http | `packages/cli/src/match-http.ts` | 外部选手入座层：/match/* 路由 + 回合门控 + 出杆限时 |
| event | `packages/core/src/match-log.ts` | MatchEvent schema 3（公开计划/复盘、实时观战/回放共享、隐藏字段 fail fast） |
| web | `packages/cli/src/web-match.ts` + `experiments/web/index.html` | 单桌实时观战；晚连历史回放；对局结束后持续服务至 Ctrl-C |

运行：
- CLI：`poolhall experiment match --a llm --b synthetic:oracle --seed 42`
- MCP：`poolhall-mcp --match --seed 42 --name-a playerA --name-b playerB`
- 实时观战：`poolhall web-match --a synthetic:oracle --b synthetic:oracle --seed 42`
- 持久公开日志：在上述命令追加 `--event-out experiments/results/live-match.jsonl`
- 离线分享：`poolhall replay-match --in experiments/results/live-match.jsonl --out replay.html`
- 真模型外部座：`node packages/cli/src/llm-seat.ts <身份名> [remote 基址]`（llm-seat.ts，对大厅/单桌均可）

实时页控制：所有局域网观众均可按当前双方配置开新局并设置 1–120 最大杆数；seed 每局递增。
服务端每广播一杆后按该杆物理时长节流，再进入下一次 Agent 决策。暂停、重播和倍速为观众本地状态。

## 4. 外部选手接入（M6.3：双外部 Agent 同桌）

“一次 stdio 会话一局”升级为**共享对局**：权威 MatchSession 在 web-match 服务侧，
外部 Agent 经 MCP remote 模式入座同一张桌，按回合出杆。内部选手（oracle/llm）
与外部选手可混编。

```
poolhall web-match --a external --b external --name-a extA --name-b extB --port 8899
# 两个外部 Agent 各自配置一个 MCP server（stdio）：
poolhall-mcp --match --remote http://host:8900 --agent extA
poolhall-mcp --match --remote http://host:8900 --agent extB
```

HTTP 入座接口（web-match HTTP 端口 = WS 端口 + 1，回合门控在服务端）：

| 路由 | 语义 |
|------|------|
| `POST /match/join {name}` | 身份名认领桌位；不符 → 404 |
| `GET /match/state` | 公开状态（轮次/比分/等待谁）；随时可查 |
| `GET /match/observe?name=` | 当前选手视角；没轮到你 → 409 `{error, turn}` |
| `POST /match/shot` | 出杆载荷（aimX/aimY/power/spin/targetBall/targetPocket/prediction）；非当前回合 → 409；受理 → 202 |

行为约定：
- 工具面不变（open/observe/shot/state）：remote 模式下 `open_match` 返回入座信息，
  409 预期流程态转成 `{waiting: true, status, turn}` 文本供 Agent 轮询，不是工具错误。
- **出杆限时**：`--shot-clock <秒>`（默认 600，0=不限时）；超时判负（`MatchSession.resign`）。
- 进程中断（Ctrl-C）发生在等待期间时不判负，直接停局。
- 隐藏状态红线：/match/* 只透出 `observe()/result` 已净化字段；公开事件日志不新增泄漏面。
- 外部选手的 `prediction` 文本进入公开计划（观战右栏）；开球由外部选手自行决定。
- 冒烟工具：`node packages/mcp/src/smoke.ts A|B [remote-url] [身份名]`（oracle 同款驱动）。
- v1 未做：断线重连（超时判负已覆盖最低容错）、双方同时抢座（身份名预分配）。

## 6. 实测（2026-08-30，真模型经 MCP remote 入座大厅）

用 `packages/cli/src/llm-seat.ts`（LlmAgentSession + prompts/match.yaml，MiniMax-M3）
经外部入座链路打了 3 局中式八球（每局 40 杆预算、出杆限时 600s、Elo 入账、公开日志落盘）。
数据在 `experiments/results/eval-*`。

### 6.1 结果总览（n=3，均平局）

| 局 | 对阵 | 结果 | 进球 | 犯规（含 scratch） |
|---|---|---|---|---|
| run1 | MiniMax-M3 ×2（反馈链路缺陷期） | 40 杆平局 | 7 | A 3（2）/ B **10**（2） |
| run2 | MiniMax-M3 ×2（反馈修复后） | 40 杆平局 | 8 | A 3（2）/ B 8（**5**） |
| run3 | oracle vs MiniMax-M3 | 40 杆平局 | 8 | oracle 9 / LLM 8 |

三局无一分出——**对局模式比校准/清台难得多**：要清组 + 打 8，任何一侧的 scratch/错组
都会打断连贯清台。连 oracle 也只在 naive 贪心下拿 3 次合法进袋（与 §5 基线一致：oracle 并不稳赢）。

### 6.2 真模型行为观察（评估核心）

- **计划质量高、执行打折**：模型能正确推理球组（"8 号在我组未清前不能打"）、
  主动用 `spin.y<0` 防 scratch、给出力度与走位意图；但手感噪声 + 自身校准不足 →
  实际命中率远低于计划预期。知与行的分裂在对局里被放大成胜负手。
- **scratch 是主要失分源**：run2 的 B 选手 5 次母球进袋——力度控制是真模型最薄弱环。
- **目标锚定**：模型会连续多杆打同一球/同一袋（run1 双方反复打 `11→lb`），
  反馈回路断裂时尤其明显（见 6.3）；修复后行为更发散、进球更多。
- **错组犯规仍发生**：反馈里已含“首触错组”文本，但模型不完全据此改换目标——
  “读规则”≠“执行规则”，这是心理层（读对手/读规则）的后续抓手。
- **延迟/成本**：MiniMax-M3 单次决策 p50 ≈ 5–6.5s、max ≈ 21s；单局累计 ≈ 6–9 万 input tokens。

### 6.3 实测抓出并修复的两个真 bug（本轮最大产出）

1. **反馈丢失**：`/match/state` 只带单杆 `lastShot`，对手下一杆即覆盖本座结果，
   导致选手几乎收不到自己的进袋/犯规反馈（run1 的 B 因此 10 犯规不收敛）。
   修复：`MatchHttp.recentShots` 环形缓冲（16 杆）+ 驱动按 `shot` 序补齐 feedback。
   对照：run2 的 B 合法进袋从 1 → 6。
2. **混编抢座**：大厅里内部座（oracle/llm）未预占，外部 agent 会抢到本属 oracle 的座。
   修复：`MatchHttp.presetSeat` 在 TableRoom 构造时预占非 external 座。
   两者均有回归测试（match-http.test.ts / lobby.test.ts）。

### 6.4 结论与后续

- 外部接入全链路（认座→回合门控→出杆→反馈→续局→Elo→回放）**真模型验证通过**。
- 对局模式天然是高难度 benchmark：40 杆内三方皆平，适合作为“长程规划 + 手感校准”综合考题。
- 后续：加大样本与模型种类（强模型对照）、接心理层（读对手 bias）、
  以及把“首触错组”反馈升级为结构化字段（当前为文本，模型利用率低）。

## 7. 心理层 v1：读对手（2026-08-30）

“读人准确率”指标的机制落地：选手观察对手的**意图角 vs 实际结果**（公开事件自带），
归纳“这家伙总偏左/偏右”，然后提交估计、服务端打分。

### 机制与红线

- `POST /match/read?table=<id>` `{name, estimateDeg}`（MCP 工具 `read_opponent`）：
  服务端用对手隐藏的 `biasBase`（习惯偏差）计分，**只返回带噪声的误差 + 方向是否对**，
  绝不回传真值。隐藏态永远只在服务侧。
- 防反推：每座每局限 **3 次**（`READ_MAX`），返回误差叠加 ±0.02° 确定性噪声（
  由 `(seed, 读者, 次序)` 流派生，可复现）——打分接口不能当二分 oracle 用。
- 每局 `attach` 重置限次；计分目标 = 对手的 `biasBase`（稳定习惯，不含单杆漂移）。
- 记录入战绩库 `reads` 表：只存估计/误差/方向命中，**不存真实 bias**；
  `Store.readStats(reader)` 出平均误差与方向命中率（/lobby/status 可后续透出）。
- 判定约定：`estimateDeg` 带符号（与出杆角同向）；估 0 = 不判方向。
- 泄漏自查：`/match/read` 响应体不含 bias/actual/hand 字样（有测试）。

### 实测（冒烟对局中 curl 读人）

| 读者 | 估计 | 误差 | 方向 |
|---|---|---|---|
| alice 读 bob | +0.10° | 0.039° | ✓ |
| alice 读 bob | −0.15° | 0.214° | ✗ |
| bob 读 alice | −0.08° | 0.201° | ✗ |

限次、入库、跨座独立均工作正常。

### 未做（后续）

- Agent 侧读人策略：llm-seat/提示词尚未引导模型从近期对手杆里归纳偏差并提交 read
  （机制已备，策略是下一个实验）
- 读人准确率进大厅页/榜单展示；安全球博弈、Hustle 藏实力

## 变更记录

- 2026-08-29 首版定稿：v1 简化规则 + 双 hand model + LLM 接入
- 2026-08-30 单桌观战链路收口：共享 MatchEvent schema 1、历史回放、HTTP/WS 生命周期与泄漏红线。
- 2026-08-30 自包含回放：公开 JSONL 可生成单文件 HTML；历史事件按杆排队播放，不依赖运行中的服务。
- 2026-08-30 修正中式开球：比赛台尺寸、长轴摆球、开球区母球、独立 break、四球碰库与开球 8 重置。
- 2026-08-30 实时控制：浏览器可开新局/设杆数；AI 按杆流式运行；观众支持暂停、重播、倍速与全屏。
- 2026-08-30 观众叙事：AI 输出公开计划摘要，服务端生成事实复盘；右栏扩展为计划与事件时间线。
- 2026-08-30 外部接入（M6.3）：web-match 支持 `--a/--b external`；`/match/*` 入座层 +
  回合门控 + 出杆限时判负；`poolhall-mcp --match --remote` 入座同桌。端到端冒烟：
  双外部 MCP 客户端打完 27 杆完整对局，公开日志零泄漏、可离线回放。
- 2026-08-30 真模型实测（§6）：MiniMax-M3 经 llm-seat.ts 打完 3 局（均平局）；
  抓出并修复反馈丢失（recentShots 环缓冲）与混编抢座（presetSeat）两个真 bug；
  新增 lastShot/recentShots 透出（外部选手反馈回路原料）。
- 2026-08-30 心理层 v1（§7）：读对手机制——`/match/read` + MCP `read_opponent`，
  隐藏 biasBase 计分、带噪声限次防反推、reads 入库（读人准确率指标地基）。
