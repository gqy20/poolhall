# CLI 规格 · cli

状态：已定稿（2026-08-28）

## 1. 定位

CLI 是第一个壳：人玩、调试、批量重放、驱动实验全走它。核心逻辑全在 engine/core 纯库，CLI 只做参数解析、输入输出、交互循环。未来 MCP server 的工具面与 CLI 命令面 1:1 映射（同一套 zod schema）。

## 2. 命令面

```
poolhall play                     # 交互 REPL：人当 agent，亲手体验手感噪声
poolhall play --driver external   # stdin/stdout JSONL 行协议驱动（见 docs/proto.md）
poolhall run -f shots.jsonl --seed 42   # 批量重放固定动作序列
poolhall replay game.phl          # 回放事件日志（文本步进）
poolhall render [file]            # ASCII 球桌快照（球位 + 可选尾迹）
poolhall trace --shot 7 --frames  # 某杆逐帧轨迹：每 10ms 球位 + 碰撞事件流
poolhall debug hand               # 查看隐藏手感参数（research 专用）
poolhall debug solve              # 最优角求解器（research 专用）
poolhall experiment calibrate --agent <id> --seeds 30
```

约定：
- 所有命令接受 `--seed`（默认 42）、`--json`（结构化输出）、`--research`（解锁 research 视图，实验/调试专用；输出带水印标记，防止误用于 benchmark 输入）
- `debug` 与 `--research` 的输出**永不进** benchmark 行协议
- 时间戳/进度走 stderr，数据走 stdout（管道友好）

## 3. REPL（poolhall play）

- node:readline 实现，命令历史持久化到 `~/.poolhall/history`
- 内置命令：`observe` / `shoot <angle> <power>` / `history` / `score` / `table`（ASCII 渲染）/ `undo`（仅实验模式）/ `quit`
- `@clack/prompts` 用于开场菜单（模式选择、感知分级）
- REPL 的 observation 永远是 agent 视图（无 bias 泄漏）

## 4. stdin/stdout 行协议（--driver external）

四种驱动者说同一种语言：人（REPL）、合成 agent（shell 脚本）、真模型（LLM 循环脚本）、未来 MCP（翻译层）。

```
stdout →  {"type":"observation", ...}   # 观察（agent 视图）
stdin  →  {"type":"shot", "angle":..., "power":..., "spin":..., "prediction":...}
```

细节见 docs/proto.md（行协议 + 事件日志 schema 统一定义）。

## 5. 实验入口（experiment calibrate）

- `--agent synthetic:random|no-comp|oracle` 三合成 agent 验机
- `--agent external:<cmd>`：spawn 子进程走行协议（LLM 脚本同理）
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
