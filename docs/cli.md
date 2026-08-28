# CLI 规格 · cli

状态：已定稿（2026-08-28）

## 1. 定位

CLI 是第一个壳：人玩、调试、批量重放、驱动实验全走它。核心逻辑全在 engine/core 纯库，CLI 只做参数解析、输入输出、交互循环。未来 MCP server 的工具面与 CLI 命令面 1:1 映射（同一套 zod schema）。

## 2. 命令面（与代码一致；2026-08-29 修订）

```
poolhall demo --scene <name>      # 演示场景一杆
poolhall render --balls <spec>    # ASCII 球桌快照
poolhall trace --scene <name>     # 某场景逐帧轨迹
poolhall solve --cue xy --obj xy --pocket id   # 最优角求解（research）
poolhall hash --scene <name>      # 轨迹哈希原料（FNV-1a）
poolhall experiment calibrate --agent <spec>   # 校准挑战实验
poolhall llm-ping                 # LLM 连通性自测
poolhall debug hand --agent <n>   # 查看某 agent 的隐藏手感参数
poolhall mcp --seed <n> --trials <n>           # 启动 MCP server（stdio）
```

**未实现的命令（roadmap M3/M5 标记 [~]，被替代或未排期）**：

| 命令 | 状态 | 替代物 / 备注 |
|------|------|---------------|
| `poolhall play` REPL | 未做 + 未排期 | Agent 入口走 MCP（M5，docs/proto.md）；CLI REPL 是"人当 agent"体验玩具，价值密度低。`@clack/prompts` 已在依赖里备着。 |
| `--driver external` 行协议驱动 | 被 MCP 取代 | 同语义由 `@poolhall/mcp` 承载，1:1 复用同一套 zod schema（mcp/tools.ts ↔ core/protocol.ts） |
| `poolhall run -f shots.jsonl` | 未做 + 无直接替代 | benchmark 工作流走 `experiment calibrate` 同 seed + 同动作序列路径 |
| `poolhall replay game.phl` | 被 HTML 回放取代 | `experiments/render-html.ts` 把同一份数据（samples/events/三元组）渲染成单文件 SVG 回放器，含预测线 vs 实际线分色 |

约定：
- 所有命令接受 `--seed`（默认 42）、`--json`（结构化输出）、`--research`（解锁 research 视图，实验/调试专用；输出带水印标记，防止误用于 benchmark 输入）
- `debug` 与 `--research` 的输出**永不进** benchmark 行协议
- 时间戳/进度走 stderr，数据走 stdout（管道友好）

## 3. REPL（poolhall play）

**未实现，未排期。** Agent 入口在 MCP（M5）。若未来要做：

- node:readline 实现，命令历史持久化到 `~/.poolhall/history`
- 内置命令：`observe` / `shoot <angle> <power>` / `history` / `score` / `table`（ASCII 渲染）/ `undo`（仅实验模式）/ `quit`
- `@clack/prompts` 用于开场菜单（模式选择、感知分级）
- REPL 的 observation 永远是 agent 视图（无 bias 泄漏）

## 4. 行协议（已由 MCP 承载）

原 §4 "stdin/stdout 行协议（--driver external）" 章节在 M5 后由 `@poolhall/mcp` 接管：MCP stdio 链路与 CLI 命令面 1:1 映射（同一套 zod schema，mcp/tools.ts ↔ core/protocol.ts）。四种驱动者（合成 agent、真模型 LLM、外部 spawn、未来 Agent）现在通过 MCP 接入而不是 CLI `--driver external` flag。

细节见 docs/proto.md（行协议 + 事件日志 schema 统一定义）。

## 5. 实验入口（experiment calibrate）

- `--agent synthetic:random|no-comp|oracle` 三合成 agent 验机
- `--agent llm`：inline Vercel AI SDK + `@ai-sdk/anthropic`（docs/tech-stack.md §10）；不再走 `--agent external:<cmd>` spawn 子进程模式
- 输出：trials JSONL（含三元组，research 视图）+ 汇总统计 JSON；出图交 experiments/ Python
- `--seeds N` 多 seed 汇总，bootstrap 置信区间由 Python 侧算

## 6. 渲染（render / table）

- ASCII 球桌：库边 `█`、袋口 `◌`、母球 `●`/`○`、彩球字母、尾迹 `·`（尾迹点来自 10ms 采样缓存）
- 比例 2:1（长宽比），80×40 标准终端
- `--research` 模式叠加：预测线 vs 实际线（`┄` vs `─`）
- 快照测试锁定输出

## 7. 退出码

0 成功；1 参数错误；2 行协议校验失败；3 物理错误（能量爆炸/死循环 watchdog）；4 研究视图违规使用（benchmark 模式下调用了 research 输出）

## 变更记录

- 2026-08-28 首次定稿
- 2026-08-29 修订：§2 命令面缩到与代码一致；play/run/replay/driver-external 四项标"未做/被替代"；§3 REPL 改"未实现未排期"；§4 行协议改"由 MCP 承载"；§5 实验入口去掉 `external:<cmd>` 改 inline AI SDK
