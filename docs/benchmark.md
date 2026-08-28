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

## 变更记录

- 2026-08-28 初版协议；同日 2×50 杆实证确立信噪比公理与准入门槛。
