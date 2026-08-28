# Roadmap · 路线图

状态：已定稿（2026-08-28）
里程碑口径：**可演示 > 可玩 > 可信 > 可传播**。每个里程碑有明确的"完成定义"（DoD），达不到 DoD 不进下一个。

## 总览

```
M0 骨架        可跑起来的空壳            ✅
M1 物理核      球真的会按物理滚起来      ✅
M2 手感系统    Agent 的手开始"背叛"它   ← 当前
M2 手感系统    Agent 的手开始"背叛"它
M3 第一条知行曲线   benchmark 立项的证明
M4 渲染器      戏剧性画给人看（Godot / SVG）
M5 MCP 生态    任何智能体推门进来就能打
M6 台球厅      常驻服务、对弈、江湖
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

- [ ] Hand model（bias/sigma/drift + OU 漂移）+ 计数器型 RNG（pure-rand）
- [ ] 身份种子：`hash(server_seed, name)` → bias（跨局肌肉记忆）
- [ ] trial 协议：`place_layout` 生成清朗局面，N=20 可配
- [ ] 双层视图：`agentView` / `researchView` + 泄漏检测测试（100 局随机断言）
- [ ] `debug hand` / `debug solve`（research 专用）
- [ ] SQLite 持久化（node:sqlite）：agent 身份、战绩、hand model 状态

DoD：同一 agent 名两次进局 bias 一致；泄漏测试全绿；`oracle` 合成 agent 稳定 90%+ 进球率。

## M3 · 第一条知行曲线（1 天）⭐ 里程碑

**目标**：benchmark 立项的证明——README 的愿景第一次被数据兑现。

- [ ] 行协议 `--driver external`（JSONL，zod 校验）
- [ ] REPL `poolhall play`（observe/shoot/history/score/table）
- [ ] 实验入口 `experiment calibrate`：三合成 agent 验机
- [ ] LLM 驱动脚本：裸 fetch 调 OpenAI/Anthropic 兼容端点，循环走行协议
- [ ] Python 出图（uv + matplotlib）：补偿曲线、知行曲线、bootstrap 置信带
- [ ] 首个真模型实验：50 杆 × 2 手感配置（bias=0 / bias>0）

DoD：三合成 agent 曲线形状符合预期（§hand-model 验机表）；真模型跑出第一条知行曲线图，入库 `experiments/`。

## M4 · 渲染器（3–5 天，可与 M5 并行）

**目标**：把戏剧性画出来。

- [ ] `poolhall export svg`：预测线 vs 实际线叠加图（不用等 Godot）
- [ ] Godot 回放器：解析 .phl，时间轴播放/暂停/拖动
- [ ] 知行差距可视化：预测线 `┄` 与实际线 `─` 分色
- [ ] 观战模式：消费净化版事件日志
- [ ] （可选）模式 B 定性描述器 + 快照测试

DoD：一局 20 杆的回放视频/动图可分享；SVG 导出一张图讲清"它什么都知道，但手背叛了它"。

## M5 · MCP 生态（2–3 天）

**目标**：任何智能体推门进来就能打。

- [ ] `@modelcontextprotocol/server` 封装：工具面与 CLI 命令 1:1（同一套 zod schema）
- [ ] 工具：observe_table / take_shot / get_shot_history / get_score（+ join_table）
- [ ] stdio 起步，每会话独占一桌
- [ ] 接入验证：Claude Code / Codex / pi 至少两家实测
- [ ] `npx poolhall`（或 pnpm dlx）一键接入文档

DoD：两个外部 agent 通过 MCP 各自完成一局校准挑战，产出知行曲线。

## M6 · 台球厅（持续）

**目标**：从 benchmark 长成生态。

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
