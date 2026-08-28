# 手感系统与校准协议 · hand-model

状态：已定稿（2026-08-28）

## 1. Hand Model 总公式

Agent 声明的出杆意图 → 注入噪声 → 交给物理核：

```
actual_angle = intent_angle + systematic_bias + ε_angle
ε_angle ~ N(0, angle_sigma)          （每杆独立）
actual_power = intent_power · (1 + ε_power),  ε_power ~ N(0, power_sigma)
actual_spin  = intent_spin  · (1 + ε_spin),   ε_spin  ~ N(0, spin_sigma)   （v1）
```

## 2. 参数与默认值

| 参数 | 默认 | 说明 |
|------|------|------|
| `systematic_bias` | ±[0.5°, 2°]（方向由种子决定） | **戏眼**。Agent 不知道方向与大小 |
| `angle_sigma` | 0.3° | 随机抖动。1m 直线球可进袋容差约 ±1.5°，bias 造成系统性 miss 而 sigma 不会——考运气与考反思分离 |
| `power_sigma` | 0.05 | |
| `spin_sigma` | 0.1 | v1 |
| `bias_drift` | OU 过程 σ=0.1°/10杆 | 局内缓慢漂移；跨局由身份种子重置到"人格均值" |
| `hand_style` | 由身份种子生成的性格向量 | 见 §4 |

所有噪声采样用**计数器型 RNG**（pure-rand）：第 k 杆噪声 = f(seed, agent_id, k)。
同一杆重算不污染流；回放无需重放 RNG 状态机。

## 3. 跨局肌肉记忆（身份）

- bias 由 `hash(server_seed, agent_name)` 生成 → 同名再来，手还是那只手
- v0 信任模型：自报姓名（可冒名），无鉴权——记录在案，v1 再议
- 局内 drift 用独立流 `f(seed, agent_id, session, shot_k)`

## 4. Trial 协议（校准挑战实验形态）

"固定 20 杆"不固定球局（球局会被上一杆改写），用**独立 trial 序列**：

1. `place_layout(seed, k)` 为第 k 个 trial 生成清朗局面：目标球距袋 0.6–1.2m、母球距目标球 0.4–0.9m、切角 ≤ 40°、无遮挡
2. Agent：观察 →（可选预测）→ 出杆一次
3. 进球 +1；无论结果换下一 trial。共 N=20（可配）
4. 秘密记录三元组：`{ intent_θ_k, optimal_θ*_k, actual_θ'_k }`（optimal 由 solve_pot 算出，永不给 Agent）

### 指标定义（都从三元组推导）

| 指标 | 定义 |
|------|------|
| 补偿曲线 | c_k = intent_θ_k − θ*_k。"右修瞄准"即 c_k 反向 |
| 发现点 | c_k 均值首次反向偏移并持续 3 杆 |
| 知行曲线 ⭐ | \|θ'_k − θ*_k\| 的滑动均值（窗口 5）；收敛 = 首次 < σ/2（σ=angle_sigma） |
| 走位质量 | 本杆结束后下一杆可进袋数（清台模式） |
| 基线对照 | bias=0 对照组测各模型几何基线误差；主指标 = 相对自身基线的下降幅度 |

### 验机合成 agent（烧真模型 token 之前必跑）

| 合成 agent | 行为 | 期望曲线 |
|-----------|------|---------|
| `random` | 乱打 | 知行曲线平直高位 |
| `no-comp` | 永用最优角 | 补偿曲线平直（c_k≈0），知行误差恒为 bias+σ |
| `oracle` | 偷看答案（读 research 视图） | 知行误差 ≈ σ，应瞬间收敛 |

三条曲线形状不对 = 管线有 bug，不是模型有意思。之后才是真模型 × 30 seeds × 2 手感配置（bias=0 / bias>0），bootstrap 置信区间。

## 5. 感知分级

| 模式 | Agent 看到什么 | 说明 |
|------|---------------|------|
| A 精确坐标 | `(cue: 25.4,130.2), ...` | **Week 1 默认**。干净的校准测量仪器 |
| B 定性描述 ⭐ | "母球偏左库三分之一处，红球贴右上袋口" | 空间心理模拟；量化误差与手感噪声叠加，测综合能力 |
| C 渲染图像 | 俯视截图 | 多模态，后置 |

模式 B 描述器：规则式（非 LLM）空间语言生成——方位词（贴库/上半区/左三分之一）、袋口关系（正对/小切角/大切角/背对）、距离按球宽倍数、遮挡检测。输出带快照测试。有意混淆：感知误差与手感噪声同测，干净测校准请用模式 A。

## 6. 双层日志（反馈泄漏防线）

**Agent 可见的**：球停哪了、进没进、得分、（自己声明的）预测。绝无 actual 出杆参数。
**研究日志私有的**：intent/actual/optimal 三角度、bias 值、drift 轨迹、采样种子。

规则：
1. `take_shot` 返回值只含**结果观察**，禁止出现实际角度/力度
2. hand model 状态只活在 server 侧（SQLite），不进任何 agent 可读输出/日志/报错
3. 双层分离的实现放 core 包同一模块（`views.ts`）：`agentView(state)` / `researchView(state)`，静态导出两个纯函数——泄漏检测测试：随机生成 100 局，断言 agentView 输出序列化后不含 actual/bias/optimal 任何子串

## 7. 开放问题

- prediction（出杆前声明预测轨迹）v0 可选、v1 强制？
- 停球后是否给 Agent "球位快照"自动包含在 observation？（倾向是）
- bias 的存在本身要不要在系统提示里告诉 Agent？（倾向：不告诉，全靠归纳）

## 变更记录

- 2026-08-28 首次定稿
