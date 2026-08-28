# 校准挑战协议与指标 · benchmark

状态：已定稿 + 实证补充（2026-08-28）
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

## 2. 信噪比公理（实证确立 ⭐）

**知行曲线可测量性的前提：模型基线角误差 < 注入手感的有效量级。**

碰撞圆杠杆放大链：手抖 ε → 碰撞接触点横移 ε·L → 出射偏差 φ ≈ ε·L/2R
（L≈0.5–0.9m，放大 10–16×）→ 中远台系统 miss。

首次真模型实验（MiniMax-M3，2×50 杆）实测：

| 组 | 真 bias | 进球 | 误差三段趋势（每段约 17 杆均值） | err 符号 |
|----|---------|------|-------------------------------|---------|
| bias 组 | −0.064°…−0.196°（恒负） | 3/50 | 35.0° → 34.4° → 26.0° | **50/50 全正** |
| bias0 组 | ±0.03°（≈0） | 1/50 | 76.6° → 63.0° → 75.1° | **50/50 全正** |

结论：

1. 两组误差符号一致（全正）且与注入 bias 无关 → 50 杆反馈会话**没有消除模型自带的
   系统性瞄准偏差**（疑似屏幕系/数学系方向混淆）。模型"有自己的手"，与注入无关。
2. 基线误差 30–75° ≫ 注入 bias 放大量（≈2.4°）→ 对几何未达标的模型，bias 发现
   实验无意义——它在补几何，不在补手感。
3. 由此确立实验准入门槛（gate）：

```
准入门：模型在 bias=0 对照组中 |actual − optimal| 的中位数 < 5°（约 2× 注入放大量）
达标   → 进 bias>0 组，测发现点 D 与收敛杆数 N
未达标 → 知行曲线只报基线事实（高位不收敛形状），不谈手感
```

4. oracle（16/20、末窗 0.07°）同时证明：在"知"达标时，物理与出图管线量得出"行"的差距。
   强几何模型（待验证）预期呈现：基线 <5° → bias 组首次右修 → 收敛。

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
|err| 中位 58°——进一步确认这是**模型几何心算能力边界**，非管线缺陷。
管线正确性由 oracle 16-20/20 锚定。宿主结论：换过准入门（中位 <5°）的模型重跑 bias 实验。

