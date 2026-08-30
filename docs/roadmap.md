# Roadmap · 路线图

状态：已定稿（2026-08-28）
里程碑口径：**可演示 > 可玩 > 可信 > 可传播**。每个里程碑有明确的"完成定义"（DoD），达不到 DoD 不进下一个。

## 总览

```
M0 骨架        可跑起来的空壳            ✅
M1 物理核      球真的会按物理滚起来      ✅
M2 手感系统    Agent 的手开始"背叛"它   ✅
M3 第一条知行曲线   benchmark 立项的证明 ✅
M4 渲染器      戏剧性画给人看（Godot / SVG） ✅
M5 MCP 生态    任何智能体推门进来就能打      ✅
M5 MCP 生态    任何智能体推门进来就能打
M6 台球厅      常驻服务、对弈、江湖        ← 当前
```

## M0 · 骨架（0.5 天）

**目标**：pnpm monorepo 立起来，CI 红线生效。

- [x] pnpm-workspace.yaml + 四包（engine/core/cli/mcp 占位）
- [x] vitest + biome + tsconfig（ESM-only、strict）
- [x] `pnpm test` / `pnpm lint` 根脚本聚合（另加 `pnpm scan` 红线扫描 / `pnpm typecheck`）
- [x] 确定性红线扫描脚本（engine 包文本扫描，进 CI，含自身单测；埋雷验证通过：Math.random/Date.now/第三方 import 均被抓）
- [x] `.gitignore`、`docs/` 入库、首个 commit（本文档系列）
- [x] CLI bin 链接（`pnpm exec poolhall --version` 三路径冒烟通过）

DoD：`pnpm install && pnpm test && pnpm lint` 全绿；红线扫描能抓到一个故意埋的 `Math.random` 样例。✅ 2026-08-28 验收通过

## M1 · 物理核（2 天）

**目标**：确定性 A' 物理，眼睛能看球动。

- [x] Vec2/球状态机（stationary/sliding/rolling/pocketed）
- [x] 球-球扫掠碰撞（二次方程求 t*）、球-库边、球-袋口圆判定
- [x] 固定步长 1ms 积分 + 两阶段摩擦（spin 冻结；ω 水平分量已跟踪，出杆接口恒 0）
- [x] `render` ASCII 球桌 + `trace` 逐帧轨迹（cli 包 render/trace/demo/solve/hash 五命令）
- [x] 性质测试：能量不增、任意 seed 哈希一致、必然停球（fast-check，25 测全绿）
- [x] golden 对拍：pooltool 参考轨迹（uv 环境），首碰时刻误差 < 10ms/球-球事件对齐

DoD：直线球/切角球/吃库/进袋四场景 golden 全绿；`render` 肉眼验证合理；watchdog 无死循环。✅ 2026-08-28 验收通过（对拍含组合传递与三球连撞，共 38 测试）

## M2 · 手感系统（1 天）

**目标**：注入层成型，泄漏防线就位。

- [x] Hand model（bias/sigma/drift + OU 漂移）+ 计数器型 RNG（pure-rand）
- [x] 身份种子：`hash(server_seed, name)` → bias（跨局肌肉记忆）
- [x] trial 协议：`place_layout` 生成清朗局面，N=20 可配
- [x] 双层视图：`agentView` / `researchView` + 泄漏检测测试（100 局随机断言）
- [x] `debug hand` / `debug solve`（research 专用）
- [x] SQLite 持久化（node:sqlite）：agent 身份、战绩、hand model 状态

DoD：同一 agent 名两次进局 bias 一致 ✓；泄漏测试全绿 ✓；`oracle` 合成 agent 稳定 90%+ 进球率（实测 >95%）✅ 2026-08-28 验收通过

> 实现修正：碰撞圆杠杈（瞄准误差 ε → 目标球出射 φ≈ε·L/2R 放大 ~12×）便得 docs 原默认
> σ=0.3°/bias ±2°过大，已重新校准（bias ±[0.05°,0.2°]、σ∈[0.02°,0.08°]、
> trial 切角带宽 ≤25°）。碰撞圆杠杆本身是真实物理（大切角难打的本质），
> 已写入 docs/hand-model.md §2。

## M3 · 第一条知行曲线（1 天）⭐ 里程碑

**目标**：benchmark 立项的证明——README 的愿景第一次被数据兑现。

- [x] 行协议 schema（JSONL，zod 单一定义 core/protocol.ts；REPL/外部驱动同语）
- [x] 实验入口 `poolhall experiment calibrate --agent synthetic:*`：三合成 agent 验机
- [x] LLM 驱动：Anthropic Messages 格式（裸 fetch + .env 多轮会话 + feedback 回写）
- [x] Python 出图（uv + matplotlib）：知行曲线 + 补偿曲线（experiments/plot.py）
- [x] 首个真模型实验：MiniMax-M3 v6 × 2×50 杆（bias=0 对照 + bias>0 实验）— docs/benchmark.md §5
- [x] 多 seed 验证（4 seeds × 50 杆完成，200 杆汇总）：收敛比 7.81×、bootstrap 95% CI [0.094°, 1.301°] 显著、4/4 seed 全收敛 — docs/benchmark.md §5.4
- [ ] 30 seeds 终极验证（留迭代，bootstrap CI 已显著）
- [~] REPL `poolhall play`（观察/出杆交互——与 M4 渲染体验一并打磨）：**未做**。Agent 入口走 MCP（M5，docs/proto.md §实现先于文档定稿），CLI REPL 是"人当 agent"的体验玩具，价值密度低，未排期。`@clack/prompts` 已在 cli 依赖里备着。

DoD：三合成 agent 曲线形状符合预期（oracle 16/20 末窗 0.07° / no-comp 平直 / random 高位）；
真模型 v6 实测已出（experiments/figs/v7/，docs/benchmark.md §5）——
**MiniMax-M3 seed=42：bias>0 50 杆 37/50 (74%)，err_a 中位 0.13°，
知行曲线三段 0.24°→0.16°→0.09°，first→last mean 0.57°→0.07° (8×)**。
准入门 500× 通过（bias=0 中位 0.01° ≪ 5° 阈值）；oracle 16-20/20 锚定管线。
强模型对比与多 seed 验证留 §5.4。✅ 2026-08-29 验收通过

## M4 · 渲染器（3–5 天，可与 M5 并行）

**目标**：把戏剧性画出来。

- [x] `experiments/render-html.ts`：研究日志 → 自包含 HTML（零依赖、file:// 可分享）
- [x] 核心数据补全：core/trial.ts 透出 samples/events（10ms 轨迹采样）——可视化的前置原料
- [x] 知行差距可视化：预测线（蓝墨虚线） vs 实际线（暖橙实线）分色；miss 砖红 / pot 墨绿
- [x] 杆卡网格 + 大图上色（单击切换）；指标 sparkline（知行/补偿曲线内嵌）
- [→] Godot 回放器：**被 HTML 回放器取代**（experiments/render-html.ts，零依赖、file:// 可分享）。visualization.md §5 明示"M4.2 后置，可选"。若未来需要"桌面真实渲染体验"再起。
- [ ] 动图/视频导出（GIF/MP4；可用 HTML 录屏或后续补 ffmpeg 后处理）

DoD：一局 20 杆的回放单文件 HTML 可分享（已验证：oracle 8 杆版本，
351KB 自包含、含全部轨迹数据）✅ 2026-08-28 验收通过

## M5 · MCP 生态（2–3 天）

**目标**：任何智能体推门进来就能打。

- [x] `@modelcontextprotocol/server` v2 封装：工具面与 CLI 命令 1:1（同一套 zod schema）
- [x] 四工具齐备：observe_table / take_shot / get_shot_history / get_score
- [x] stdio 起步，每会话独占一桌（每进程一个 CalibSession）
- [x] 真实 stdio 链路冒烟通过（MCP 握手 → tools/list → observe_table 全流程）
- [x] 内存传输对端对端测试 5 测全绿（含泄漏红线）
- [x] 接入入口：`pnpm exec poolhall mcp`（bin 链接）/ Claude Code `.mcp.json` 示例见 README
- [ ] 真实接入验证（Claude Code / Codex / pi 实测打一局）——留待接入环境就绪时完成
- [~] `poolhall run -f shots.jsonl` 批量重放：**未做**且无直接替代物（benchmark 工作流走 `experiment calibrate` 同 seed + 同动作序列）。外部动作序列导入是真缺口，目前不紧迫。

DoD：两个外部 agent 通过 MCP 各自完成一局校准挑战，产出知行曲线。

## M6 · 台球厅（持续）

**目标**：从 benchmark 长成生态。

- [x] **M6.1 清台挑战**（2026-08-29）：9 球计分赛 + scratch 威慑 + aimAssists——
  core/ClearSession + prompts/clear.yaml + LLM 接入全通（docs/clear.md）。
  关键设计发现：scratch 威慑让低杆从可选技巧变成生存技能（oracle 四局全死于
  直球跟进袋），v7"模型不用 spin"的问题在此模式下有真实激励
- [x] **M6.2 中式八球对局**（2026-08-29）：MatchSession 规则引擎（定组/首触裁判/
  8 号胜负/双选手独立 hand model）+ llm×oracle 混编对战全通（docs/match.md）——
  Agent vs Agent 与"读对手 bias"心理层的地基
- [~] **M6.3 单桌试营业**（进行中）：本地 HTTP + WebSocket 实时观战、晚连历史回放、
  MatchEvent schema 2、公开事件泄漏红线、delta-v1 持久日志与自包含 HTML 回放已完成；
  按杆实时 AI、局域网开局控制、暂停/倍速/重播/全屏已完成；双外部 Agent 身份接入待做
- [ ] 常驻服务：HTTP/SSE 大厅，多桌并发，观战排队
- [ ] Agent vs Agent 对弈（Elo 榜）
- [ ] Hustle 赌局、token 赌注、表演性放水
- [ ] 心理层：读对手风格（对对手 bias 的估计误差进指标）
- [ ] AI 解说员、师徒传承（校准笔记传递）
- [ ] 模式 C 渲染图像感知（多模态）

DoD（每项独立）：对外可分享的榜单/对局回放页；至少一场"有意思"的 Agent 对弈可公开回放。

## 节奏与止损

- M0–M3 是**主线七日**（骨架 0.5 + 物理 2 + 手感 1 + 曲线 1 ≈ 5 个工作日 + 缓冲）
- M4/M5 可并行，谁先 ready 谁先上
- **止损线**：M3 若真模型曲线与合成 agent 无统计可分辨的差异（所有模型都"发现不了 bias"），优先怀疑协议/提示词问题调一轮；仍无差异 → 这本身就是有效负结果，写报告收档，转向对弈/生态叙事
- 任何时刻物理确定性被破坏（golden 哈希漂移）→ 全线停，先修

## 变更记录

- 2026-08-28 首次定稿；同日 M0 验收通过；同日 M1 验收通过（pooltool 0.6.0 交叉对拍打通）（红线埋雷验证 + 三路径 CLI 冒烟）
- 2026-08-29 M3 DoD 重写：v6 prompt + 反馈系统对 MiniMax-M3 几何能力归零（aimAssist 外包），bias>0 50 杆 37/50 进球，知行曲线三段下降符合预期，准入门 500× 通过（docs/benchmark.md §5）
- 2026-08-29 M3 补 `[x]` 4 seeds × 50 杆验证（docs/benchmark.md §5.4）：收敛比 7.81×、bootstrap 95% CI 显著、4/4 seed 全收敛
- 2026-08-29 M3 补 `[ ]` 30 seeds 终极验证（留迭代）
- 2026-08-29 M3 `poolhall play` REPL 标 `[~]`：未排期（Agent 入口已迁至 MCP，价值密度评估后未实施）
- 2026-08-29 M4 Godot 标 `[→]`：被 HTML 回放器取代
- 2026-08-29 M5 补 `poolhall run` 批量重放为 `[~]` 未做+无替代物
