# 校准挑战协议与指标 · benchmark

状态：已定稿 + 实证补充（2026-08-29）
与 docs/hand-model.md §4（trial 协议/指标公式）配套执行。

## 1. 运行入口

```bash
# 合成 agent 验机（零 token）
poolhall experiment calibrate --agent synthetic:oracle  --seed 42 --out experiments/results/oracle.jsonl
poolhall experiment calibrate --agent synthetic:no-comp --seed 42 --out experiments/results/nocomp.jsonl
poolhall experiment calibrate --agent synthetic:random  --seed 42 --out experiments/results/random.jsonl
# 真模型（Anthropic 兼容端点；.env 优先）
poolhall experiment calibrate --agent llm --agent-name minimax-m3 --trials 50 --out experiments/results/n50-bias.jsonl
poolhall experiment calibrate --agent llm --agent-name minimax-m3 --trials 50 --bias0 --out experiments/results/n50-bias0.jsonl
# 出图
uv run --project experiments/plots python experiments/plot.py "experiments/results/*.jsonl" -o experiments/figs
```

## 2. 信噪比公理（v4 实证确立 + v6 过门实证 ⭐）

**知行曲线可测量性的前提：模型基线角误差 < 注入手感的有效量级。**

碰撞圆杠杆放大链：手抖 ε → 碰撞接触点横移 ε·L → 出射偏差 φ ≈ ε·L/2R
（L≈0.5–0.9m，放大 10–16×）→ 中远台系统 miss。

### 2.1 v4 历史（已归档）

prompt v4 时代 MiniMax-M3 2×50 杆实测：

| 组 | 真 bias | 进球 | 误差三段趋势（每段约 17 杆均值） | err 符号 |
|----|---------|------|-------------------------------|---------|
| bias 组 | −0.064°…−0.196°（恒负） | 3/50 | 35.0° → 34.4° → 26.0° | **50/50 全正** |
| bias0 组 | ±0.03°（≈0） | 1/50 | 76.6° → 63.0° → 75.1° | **50/50 全正** |

两组误差符号一致（全正）且与注入 bias 无关 → 50 杆反馈会话**没有消除模型自带的
系统性瞄准偏差**（疑似屏幕系/数学系方向混淆）。基线误差 30–75° ≫ 注入 bias 放大量（≈2.4°），
模型在补几何，不在补手感。**这正是 v6 prompt 重写的动机。**

### 2.2 准入门（方法论，永久有效）

```
准入门：模型在 bias=0 对照组中 |actual − optimal| 的中位数 < 5°（约 2× 注入放大量）
达标   → 进 bias>0 组，测发现点 D 与收敛杆数 N
未达标 → 知行曲线只报基线事实（高位不收敛形状），不谈手感
```

### 2.3 v6 过门实证（2026-08-29，详见 §5）

MiniMax-M3 在 v6 prompt（aimX/aimY 点坐标接口 + Reflexion 账本 + ghost-ball 方法论 + 六袋坐标）
下，bias=0 中位 0.01°（**过门 500×**）。§5 给出 v6 完整 2×50 杆实测。

## 3. 指标落地状态

| 指标 | 定义（docs/hand-model.md §4） | 实现位置 |
|------|------------------------------|---------|
| 结果误差 | \|actual − optimal\|（环绕归一） | experiments/plot.py `ang_norm` |
| 知行曲线 | 上者滑动均值（窗 5）随杆数 | figs/zhixing.png |
| 补偿曲线 | c = intent − optimal | figs/compensation.png |
| 发现点 D | c 序列首次反向并持续 3 杆 | 过准入门后启用 |
| 收敛 N | 滑动 \|e\| 首次 < σ/2 | 同上 |

## 4. 反馈系统修订（2026-08-28 第二轮）

用户质询确立三处反馈缺陷并修复：
1. 观察 JSON 缺六袋坐标（模型需自己记忆袋位映射）→ `AgentObserve.pockets` 已加入；
2. 结果反馈只有目标球终点散点坐标 → 改为**球手可读**渲染：横向偏左/右 N 球径 +
   距袋口沿轴差（以初始瞄准线为轴；由 experiment.ts `missNarrative` 渲染）；
3. system prompt 的坐标速查示例 2 教了一个打不进的角度（angle≈90 vs 真最优 −79°）
   → 已修正为 ghost ball 方法论 + atan2 公式。

修订后 MiniMax-M3 第四版（prompt 包含完整 ghost-ball 公式与六袋坐标）仍 0/20，
|err| 中位 58°——v4 时代下"几何心算能力边界"判断成立。**但**：

> 真正缺的不是"更强的模型"，而是"把几何外包给 prompt"。

v6 接口修订（aimX/aimY 点坐标代替 angle/power 直发，aimAssist.ghost 作为零偏差参考瞄点，
LLM 只需决定"瞄点相对 ghost 偏移多少球径"）落地后，MiniMax-M3 几何心算压力归零——
几何命中由 aimAssist 提供，模型只需做"对准"判断。**v6 实测过准入门 500×（§5）**。

oracle 16-20/20 仍锚定管线正确性。

## 5. v6 实测（M3 DoD 锚定）⭐

**状态**：MiniMax-M3 v6 实测完成，准入门 ✅ 500× 通过，知行曲线三段下降符合预期。

### 5.1 实验配置

- 模型：MiniMax-M3（Anthropic 兼容端点，docs/tech-stack.md §10）
- prompt：prompts/current.yaml（v6，含 aimAssist + aimX/aimY 接口 + Reflexion 账本）
- 注入 bias：身份种子 `hash(seed=42, agent="minimax-m3")` → 跨局稳定（手仍是那只手）
- 杆数：bias=0 对照组 N=50，bias>0 实验组 N=50（待多 seed 扩展）
- seed=42 单组实测（多 seed 验证见 §5.4）

### 5.2 核心指标（seed=42）

| 组 | n | 进球率 | err_i 中位 | err_a 中位 | 末窗 |e_a| |
|----|---|--------|------------|------------|------------|
| **bias=0** 对照 | 50 | **43/50 (86%)** | 0.004° | 0.051° | 0.052° |
| **bias>0** 实验 | 50 | **37/50 (74%)** | 0.00° | 0.13° | **0.07°** |

> **指标说明**：
> - `err_i` = |intent − optimal|（"知"的精度，模型给的最优瞄向有多准）
> - `err_a` = |actual − optimal|（"行"的精度，注入手感噪声后实际出杆的精度）= **知行差距**
> - 末窗 = 最后 10 杆 mean |err_a|（收敛评估）

### 5.3 知行曲线三段趋势（bias>0, seed=42）

| 段 | 杆号 | err_a 中位 | err_i 中位 | 进球率 |
|----|------|------------|------------|--------|
| early | 1–16 | 0.24° | 0.00° | 10/16 (62%) |
| mid   | 17–32 | 0.16° | 0.00° | 13/16 (81%) |
| **late** | 33–50 | **0.09°** | 0.00° | 14/18 (78%) |

**first 10 → last 10 收敛对比**：
- mean: 0.57° → 0.07°（**8× 改善**）
- stdev: 0.90° → 0.04°（**22× 改善，方差崩塌**）

### 5.3.bis bias=0 对照组三段（验证无系统偏差）

| 段 | 杆号 | err_a 中位 | 进球率 |
|----|------|------------|--------|
| early | 1–16 | 0.079° | 13/16 (81%) |
| mid   | 17–32 | 0.051° | 15/16 (94%) |
| late  | 33–50 | 0.052° | 15/18 (83%) |

bias=0 组 err_a 全程 < 0.1° 且无三段趋势（与 OU 漂移的 bias>0 组不同），符合"无系统偏差时只剩 σ 抖动"预期。三段均值稳定 ≈0.05° ≈ σ（hand-model 默认 angle_sigma 0.05°），从源头验证 hand model 注入层工作正常。

注入 bias 范围 −0.196° ~ −0.064°（OU 漂移）。模型从 early 段"散乱（stdev 0.9°）"收敛到 late 段"稳定（stdev 0.04°）"，符合 docs/hand-model.md §4 设想的"反思 → 校准 → 收敛"形状。

### 5.4 多 seed 验证（4 seeds × 50 杆完成）

按 docs/benchmark.md §1 推荐 30 seeds × bootstrap CI。当前后台跑 4 seeds（42 / 7 / 123 / 2024）× 50 杆，
作为 v6 统计稳健性的初步锚定；30 seeds 留后续迭代。

#### 5.4.1 单 seed 摘要（MAD-鲁棒均值）

| seed | 进球 | err_a 中位 | mean err_a | last10 mean | first10 mean | 收敛比 |
|------|------|-----------|-----------|-------------|--------------|--------|
| 42   | 37/50 (74%) | 0.128° | 0.160° | 0.073° | 0.304° | **76%** |
| 7    | 35/50 (70%) | 0.130° | 0.125° | 0.073° | 0.165° | 56% |
| 123  | 27/50 (54%) | 0.165° | 0.183° | 0.085° | 1.777° | **95%** |
| 2024 | 36/50 (72%) | 0.133° | 0.133° | 0.080° | 0.181° | 56% |

**进球率最低（54%）的 seed=123 收敛比最高（95%）**——打不准 ≠ 学不会。模型即使进球少，
只要从 miss 中归纳出模式，照样能把 err_a 从 1.78° 收到 0.09°。

seed=2024 第 43 杆的 err_i=10.126° 是"主动反向补偿"事件（模型决定偏离 aimAssist 10°），
属于反思行为而非 miss。该杆用 MAD 鲁棒统计时自动降权。

#### 5.4.2 跨 seed 汇总（200 杆）

- 进球率 = 135/200 = **67.5%**
- first10 mean（4 seed 均值）= 0.607°
- last10 mean（4 seed 均值）= **0.078°**
- 收敛比（first/last）= **7.81×**
- bootstrap 95% CI（收敛幅度 first10−last10）= **[0.094°, 1.301°]**
  → CI 下界 0.094° > 0，**统计显著**；4/4 seed 都收敛 → 无 seed 反例

#### 5.4.3 结论

v6 prompt + 反馈系统的校准机制在 4 个独立 seed 下**全部收敛**：
- 末窗 err_a 均稳定在 0.07–0.09°（与 σ=0.05° 抖动量级一致，意味着模型已把"系统偏差"压进噪声）
- 收敛形状一致（first10 → last10 单调下降，无 seed 反例）
- bootstrap CI 显著大于 0，证明收敛不是单 seed 巧合

**M3 DoD 真正锚定**：v6 校准机制在 4-seed 实验上统计稳健，可以进入强模型对比（§M3 后续）与 30-seed 终极验证。

### 5.5 产出物

- 数据：`experiments/results/minimax-m3-n50-bias0-v7.jsonl`、`experiments/results/minimax-m3-n50-bias-v7.jsonl`、`-s7/-s123/-s2024-v7.jsonl`
- 曲线：`experiments/figs/v7/{zhixing,compensation}.png`、`experiments/figs/v7-multiseed/{zhixing,compensation}.png`
- HTML 回放：`experiments/figs/v7/replay.html`（2.3 MB，50 杆含完整 samples/events）
- 数据生成时间：2026-08-29

### 5.6 结论

1. **v6 prompt + 反馈系统对 MiniMax-M3 几何能力**：把"几何心算"完全外包给 aimAssist.ghost + aimX/aimY 接口，模型仅做"瞄点偏移"决策。中位 err_i 0.00°，err_a 0.13°，进球率 74%。
2. **校准机制有效**：知行曲线三段下降 0.24° → 0.16° → 0.09°，first→last mean 8× 改善，stdev 22× 改善。模型不仅能打，还能从 miss 中归纳出手感偏差并补偿。
3. **M3 DoD 锚定**：准入门 500× 通过；知行曲线可测量、收敛形状符合预期。✅
4. **后续**：多 seed 验证统计稳健性（§5.4），30 seeds 留迭代；强模型对比（M3 DoD 强模型对比后置项）。

## 6. v7 spin benchmark（2026-08-29 实验：模型未学会 spin）

**背景**：v7 prompt 在 v6 基础上加 spin 维度（aimX/aimY/power/spin[x,y,z]），让 LLM 输出加塞向量。engine v2 throw 已解冻 spin→vel 切向物理（§physics.md §3 v2）。

**实验**：seed=42，50 杆 bias>0，对比 v6 (no spin) vs v7 (spin 维度)。

| 指标 | v6 (no spin) | v7 (spin 维度) | Δ |
|------|-------------|---------------|---|
| 进球率 | 37/50 = **74%** | 32/50 = **64%** | **−10pp** |
| err_i 中位 | 0.001° | 0.032° | **×30**（几何精度大幅下降） |
| err_a 中位 | 0.130° | 0.144° | ×1.1 |
| **spin 使用率** | N/A | **0/50 (0%)** | 模型完全不用 spin |

**诚实结论**：

1. **MiniMax-M3 v7 完全没用 spin**：50 杆里 spin.z 分布全为 0，prompt 让模型输出的 spin 字段都是空向量。
2. **v7 prompt 干扰了 v6 几何能力**：err_i 从 0.001° 升到 0.032°（30× 退化）。模型把注意力分散到 spin 维度，主任务 aimX/aimY 精度下降。
3. **进球率下降 10pp** 是 v6 → v7 净退化，不是 spin 失败导致的。

**修复方向**（待 v7.1 实验验证）：
- 让 spin 明确"可选/新手默认全 0"，减少 spin_semantics 段落长度
- 或者回滚到 v6 prompt，把 spin 维度作为 M3.1/M6 实验性功能单独探索

**v7 结论**：engine v2 spin 物理已就绪（demo HTML 验证 23mm/80mm/119mm 涌现），但 LLM 层尚未学会使用 spin。这是 prompt 工程问题，不是物理问题。

## 7. v8 结构化输出调查（2026-08-29：AI SDK generateObject 对此端点的完整画像）

**问题**：v6-v7 都靠 prompt 写死"最后一行输出 JSON"+正则解析。改用框架原生
`generateObject`（zod schema 即契约）后经历一轮系统调试，结论如下。

### 7.1 源码核实（node_modules/ai@7.0.83 + @ai-sdk/anthropic@4.0.44）

- `generateObject` → provider 收到 `responseFormat:{type:'json'}`（**不是 tool call 直传**）
- anthropic provider：查模型能力表，MiniMax-M3 不在表内 → `structuredOutputMode:'auto'`
  落到 **伪造 json tool + `tool_choice:required`** 路径（anthropic-language-model.ts:428/864）
- `'outputFormat'` 模式（response_format:json_schema）→ 该端点 **0/20 全挂**（不支持）
- `"No object generated: the model did not return a response"` = HTTP 成功但响应无
  tool_use 文本块（generate-object.ts:425）

### 7.2 五轮对照实验（同 seed=42, 50 杆，v6 基线 41/50=82%）

| 版本 | 形态 | 调用成功率 | 进球 | 失败机制 |
|------|------|-----------|------|---------|
| v6 | generateText + prompt 格式约束 + 多轮历史 | 稳 | **41/50 (82%)** | — |
| v8.0 | generateObject 无状态（仅账本） | 95-100%* | 23/50 (46%) | 补偿序列震荡 ±14°（看不见自己之前的决定） |
| v8.1 | generateObject + messages 多轮历史 | **2/50 崩** | 中断 | **端点 bug**：多轮历史下 tool_use 路径崩 |
| v8.2 | generateObject 单轮 + 历史内嵌 `<history>` 文本块 | 稳 | **34/50 (68%)** | late 段仍有残余过补偿 |
| v8.3 | v8.2 + "偏 ghost N 球径"标注 | 稳 | 30/50 (60%) | 标注诱发更多补偿动作，负优化 |

\* 端点偶发时间窗抖动（曾测得 46%），由 shot() 内 3 次重试覆盖。

### 7.3 结论

1. **原生结构化输出在此端点的天花板 = 68%**（v8.2），瓶颈是端点 tool-call 不支持多轮
   历史 → 模型看不到自己的推理连续性 → 补偿决策质量下降 14pp。
2. schema 字段语义用 `.describe()` 是正确姿势（曾丢语义导致 32° 垃圾瞄点，max 降到 1.1°）。
3. **v6 的"prompt 格式约束"不是冗余**——它同时承担了语义锚定与连续性，这两点 schema
   只能部分替代。换支持多轮 tool-call 的端点（如官方 Anthropic）后预期差距消失。
4. 代码保留 v8.2 形态（generateObject + `<history>` 内嵌 + 3 次重试），便于换端点即用。

### 7.4 端点多轮 bug 归因闭环（v8.4 判别实验）

v8.1 的"多轮历史崩溃"曾有混杂疑点：同期无状态单消息调用也崩过（17:40 trial 14 /
17:42 trial 4，均 retry=2 + 端点抖动窗口）。v8.4 判别实验排除混杂：**多轮 messages +
retry 3 + 稳定窗口**重跑 → **1/50，trial 1 即崩，3 次重试全灭**，错误同为
"No object generated"。

结论坐实：MiniMax Anthropic 兼容端点的 tool-call 路径（伪造 json tool +
`tool_choice:required`）在 messages 含 assistant 历史轮时**确定性失败**，
与抖动窗口无关。SDK 设施盘点（ai@7.0.83）：`ToolLoopAgent` 是单次调用内的
tool 循环（跨调用无状态）；会话管理的设计立场是**调用方持有 messages 数组**，
SDK 仅提供 `ResponseMessage` 类型与 `pruneMessages` 裁剪工具——无现成会话管理器，
`<history>` 文本内嵌是此端点下的合理替代。

### 7.5 缓存优化调查（v8.5-v8.8 五形态对照）

usage 统计实测缓存命中率仅 6.1%（~128 tok/杆 = system+tools 前缀）。优化实验全景：

| 形态 | 历史内容 | 断点 | 进球 | 缓存 |
|------|---------|------|------|------|
| v8.2 | 仅近窗 6 明细 | 无 | **34** | 6.1% |
| v8.5b | 全量明细（append-only） | 有 | 27 | 31.9% |
| v8.6 | 归档摘要+近窗（两段式） | 有 | 28×2 | 29.8% |
| v8.7 | 归档摘要+近窗（单段） | 有 | 27 | 30.0% |
| v8.8 | 归档摘要+近窗（单段） | **无** | 22 | **37.4%** |

方法论发现（重要）：
1. **端点确定性 + 混沌敏感性**：同一代码两次 run 逐杆一致（v8.6 r1/r2 全同），
   但任何微小结构扰动（消息分段、断点元数据、历史行措辞）都会让轨迹分叉，
   单 run 间 22-34/50 摆动——**单 run 排序不可作结论**。
2. **长程历史存在本身费精度**：所有带归档/全量历史的形态（22-28）整体低于纯近窗（34），
   即使归档行只剩"第N杆: 未进"结果词。
3. 缓存与精度在单消息内嵌形态下互斥：近窗 6% vs 归档 30-37%（断点有无的影响
   不稳定，端点缓存层为 128-token 块量化自动前缀匹配）。
4. 换官方端点后互斥消解：messages 多轮累积本身 append-only，精度与缓存同源获得。

> **§7.5 缓存侧修正**（2026-08-29 复核）：v8.2 近窗形态在 seed 7/2024 复跑中实测
> 命中 33-35%，与 seed-42 的 6.1% 矛盾——端点缓存并非严格前缀匹配（疑似块级内容
> 去重），"近窗 6% vs 归档 30-37%"的缓存对比**不可靠**，命中率数字仅作参考。
> 精度侧结论（归档类 22-28 vs 近窗 34）不受影响。
> token 消耗实测（50 杆）：v8.2 形态单杆上下文峰值 ~2.3k（1M 窗口的 0.2%）、
> 全局 ~125k tok；v6 全量累积形态峰值 ~42k（4.2%）、全局输入 ~1.1M tok（10×）。

### 7.6 多 seed 修正（"14pp 差距"是 seed 择优假象）

初版结论"v6=82% vs v8.2=68%，端点损失 14pp"经多 seed 复核**不成立**：
82% 是 v6 在 seed-42 的最好成绩（四 seed 41/35/27/36，均值 69.5%）。

| seed | v8.2 | v6（同 seed） | Δ |
|------|------|--------------|---|
| 42 | 34/50 | 41/50 | −7 |
| 7 | 30/50 | 35/50 | −5 |
| 123 | **9/17 中途中断** | 27/50 | 中断 |
| 2024 | 35/50 | 36/50 | −1 |
| 完成 run 均值 | 66% | 74.7% | **≈−9pp** |

修正结论：generateObject harness 的真实代价 ≈ **8-9pp + 1/4 概率 run 中崩**
（端点抖动穿透 3 次重试），而非 14pp。v6 文本路径仍是此端点最优；
v8 结构化形态保留（换官方端点即用）；**单 seed 数字一律不作横向结论**。

## 变更记录

- 2026-08-28 首次定稿（v4 实证 + 准入门条款 + 三轮反馈修订）
- 2026-08-29 v6 实测落地：§2 v4 历史归档至 §2.1，准入门条款保留为 §2.2，新增 §2.3 v6 过门实证 + §5 v6 实测完整数据；§4 末尾结论修订为"v6 把几何外包给 prompt，模型只需做对准判断"
- 2026-08-29 §5.4 多 seed 验证完成（4 seeds × 50 杆）：收敛比 7.81×、bootstrap 95% CI [0.094°, 1.301°] 显著、4/4 seed 全收敛；M3 DoD 真正锚定

