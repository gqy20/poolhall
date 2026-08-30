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
同名选手跨局手感记忆保留。这是"读对手 bias"心理层的地基（hand-model.md §心理层）。

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

## 5. 基线（2026-08-29 首测）

| 对局 | 结果 | 特征 |
|------|------|------|
| oracle vs oracle（4 seed） | 合法清台胜 / 提前进 8 负 / 打 8 scratch 负 | 犯规 4-20 次/局（naive 双方互喂） |
| llm vs oracle（seed 42，12 杆） | **LLM 胜**（oracle 第 8 杆误进 8 判负） | LLM 会自选目标组合；管线全通 |

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
