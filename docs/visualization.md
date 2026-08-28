# 可视化前端设计 · viz

状态：草稿（2026-08-28）
范围：知行曲线 / 补偿曲线 / 回放（预测线 vs 实际线）的**前端呈现层**设计。
决策权：提案待评审。视觉规则（§3）一旦定稿，"改配色 = 改 tokens，不动 JS 逻辑"。

## 0. 需求盘查（为什么 matplotlib.png 不够）

| 现状 | 缺什么 |
|------|--------|
| `experiments/plot.py` 出 PNG | 静态、固定裁剪、无 hover，多 agent 排序难 |
| `render.ts` ASCII | 调试用，与人分享分辨率不够 |
| Godot 回放器 | roadmap M4 大项，开发成本高；README 的"台球游戏"终极形态，但不是第一交付 |
| `shot_ledger`/知行曲线 | 数据都在 JSONL，但**没有可视化消费通道**——"算得出却打不进"的故事讲不出来 |

**第一性需求**：一张可分享的 `index.html`，打开即可用——播放一局、看知行差距、看校准收敛。

## 1. 技术选型

| 候选 | 结论 | 理由 |
|------|------|------|
| React + Vite | ✗ | 过度；加构建链违反"零依赖/可审计" |
| Godot 4 回放器 | 后置 M4 | 桌面桌面叙事与环境搭建一周起跳；JSONL 播放纯渲染 |
| React 框架 | ✗ | 依赖树重；static HTML 逻辑本来简单 |
| **dilityd3 v7 + 单文件 HTML** | ✅ 采 | 依赖轻（单 lib ~250kb）、零构建；图表工具链可复用；生成器脚本在 experiments/ |

### 交互模型（三层递进）

1. **L1 · 进阶静态**：SVG 静态（当前 `plot.py` svg 化 + 足量结果一次渲染）
2. **L2 · 交互**（default）：单文件 `index.html`（`node experiment/render-web.ts` → 输出），
   hover tooltip / 图层开关 / 播放器 —— 无服务器；数据 JSONL 内嵌 base64
3. **L2 · 回放器**（M4 完整）：时间轴 scrub + 预测线 vs 实际线渐显（需要 sample 数据填充）

**不推荐**：
- React/Vue/Vite：对单页分享是工具链过剩，构建链冲突我们的"零依赖审计"哲学
- ECharts/Plotly：图形丰富但**视觉语言生硬**，且带 500kb+ 依赖，和"自家台球桌美学"难融合
- Godot：留 M4 后期，做"真的桌面播放器"版本；本次先跳过

## 2. 配色系统

设计原则：
- **非彩虹**——用"**知/行**"二元性做主线：预测线 = 冷色（蓝/靛），实际线 = 暖色（橙/琥珀）。
  观者一眼知"哪条是心算，哪条是手上"；加重对比但不刺眼。
- 整体底色用浅纸色（`#f8f7f2` 或 satina 白）——像一间台球厅的桌面木纹 rested 品位；
  深色模式提供"夜间台球室"版（背景 #1a1a1a，线色反转）。
- 语义色板（最大 5 色，反复使用）：
  * 主墨色 (Ink Black) `#2b2b2b`：主体线条/文字/大部分元素
  * 墨绿 (Felt Deep Green) `#1B4D3E`：台球桌呢子的主色——识别"这是台球"的品牌色
  * 暖橙 (Amber) `#E07020`：实际轨迹（误差深浅用 `#E8A94D` to `#D9730D`）
  * 蓝墨 (Predict Blue) `#2D5E8A`：预测/意图
  * 灰烟 (Muted Gray) `#94989E`：次要/网格/基线
- **不用**的默认色：浅紫粉（廉价感）、荧光绿（泛 UED）、彩虹全谱（信息过载）。

**数据语义色**：

| 语义 | 用色 | 实现细节 |
|------|------|---------|
| 预测线 (`intent / optimal`) | 蓝墨 `#2D5E8A`，虚线 | 25% 透明度叠加作"心算"层 |
| 实际线 (`actual`) | 暖橙 `#D9730D` | 主讲述线，实体 |
| 组间曲线（知行曲线） | 每个模型一个双色组（蓝 + 橙同主调），深浅区分 | 避免彩虹 |
| 进袋/成功 | 墨绿 `#1B4D3E`（绿确认） | 标记用实心圆点 + 微光 |
| 未进袋 | 砖红 `#B94A48` | 低频出现，只做强调 |
| 底/纸色 | 浅纸质 `#F7F4EE` | Tufte wide-margin 设计 |

## 3. 组件风格

- **碳粉质感复刻台球厅氛围**：台面用**墨绿呢**色 + 木库边（暖棕 `#7C4A18`）真实纹理——不是"科技感"冷白色
- **字体**：`Inter` / `IBM Plex Sans`（正文）+ `JetBrains Mono`（数字/坐标/表格），大字号使用 `Space Grotesk`（数字感品牌一致）
- **轨迹**：使用 Bezier 曲线 + 5%-transparent 递减发光，**不做"闪电"—**保留专业感
- **组件风格**：flat 设计；按钮和开关用 1px 边框（1.5px radius 2px）；无 box-shadow
- **图表组件**：axis 字体 12-13px；网格 opacity 0.3；只有外在轴，不画全框
- **交互**：hover 抬杆光效（todo 预览线）、L1 用 opacity 变淡替代高亮（保持"数学纸"感觉），关键帧标注（箭头+注释）代替 tooltip 重置。
- **布局**：
  1. 图例**集中左上（右上角焦点不占）＋关键指标显示**（命中率/补偿量）
  2. tuple 布局（2×2 网格）：知行曲线 / 补偿曲线 / 桌面回放 / miss 分布
  3. 用文字注解代替 legend 大段（少即是多）

## 4. 展示优先级 / 展示节奏

- **首屏一图**："知行曲线主图"（时间轴杆数 × 误差滑动均值），双线（冷=意图，暖=实际），一键高亮 miss 杆
- click on ball → 只在 hover 才显示 tooltip（数据点数值）
- 台球桌面图 = 回放：目标球轨迹线前3步呈现**
  - 预测线（虚线） ≠ 实际线（轨迹）：两杆的**分离程度**就是知行差距——比 raw 曲线直观
- **默认呈现=最新模型一次结果**；旧版本日志 Established 会话（v1-v5）支持折叠显示

## 5. 技术路线结论

| 项 | 选型 | 理由 |
|----|------|------|
| 栈 | **纯静态 HTML + d3 v7 裸 SVG** | 无构建链；base64 内嵌 JSONL 数据；5 分内可生成；（不写 React build chain） |
| 坐标系 | 用 SVG `viewBox` 映射台面 (0—1.9812, 0—0.9906) | 书写精确坐标 × 可读量尺 |
| 曲线 | d3.line + axis | 观察 Plot 丰富但体积重（600kb+），本场景线少，手动 SVG 即可 |
| 字体 | font-family: "Inter", "IBM Plex Sans"; 数字 `JetBrains Mono` | 无远程字体（file:// 打开即能显示） |
| 图表风格 | Minimal Tufte：极细线条、类桌面色 | 避开视觉 gewgaws；干货优先 |
| 交付 | `experiments/render-html.ts` → `experiments/figs/index.html` | docker-free、file:// 打开、可 GitHub Pages |
| Godot | M4.2 后做（可选） | 专做"台球桌面真实渲染"体验（播放/暂停/拖动），但只针对有 samples 的回放 |

## 6. 待办（周次草案）

#### Step 1（M4.1 半天）
- [ ] 设计 tokens 文档（本文件的配色/字体/间距）
- [ ] `experiments/render-html.mjs`：输入 research JSONL，输出 `figs/replay-<agent>-<seed>.html`
- [ ] 支持：知行曲线 + 补偿曲线 + 台面轨迹（基于 finalBalls 反推的线段对比） + miss 标注
- [ ] 零依赖（裸 SVG + CSS，不引 d3）

#### Step 2（M4.2，若 v1 有反馈）
- [ ] hover 交互 + 叠加"预测线 vs 实际线"双线（目前只有 finalBalls 单线）
- [ ] 引入 d3 夏合（或 Vege）支持横向坐标系缩放/滑动

#### Step 3（M4.2，往往跳过 v0）
- [ ] Godot 4 回放器消费 sample 丰富的 .phl 文件（先补 core 输出 samples 字段）

## 参考
- Tufte style: minimal ink, max data
- 关键字号：10px/12px/14px/16px；行高 1.4；数字 Space Grotesk mono
- 颜色取样：Tailwind slate/green/amber，手动调灰度（不用浅蓝紫）
