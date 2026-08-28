# 物理核规格 · physics

状态：已定稿（2026-08-28）
默认常数溯源：pooltool-billiards 0.6.0（`pooltool/objects/ball/params.py`、`table/collection.py`），上游是 Dr. Dave（billiards.colostate.edu）物理参数页。

## 1. 坐标系与单位

- 俯视 2D。原点在台面左上角，x 向右，y 向下（屏幕坐标一致，渲染零换算）
- 内部单位：SI（米、千克、秒、弧度）；对外接口（CLI/协议）角度用**度**
- JSON 输出浮点保留 6 位小数（微米级，足够渲染与对拍）
- 台面类型 v0 唯一：`seven_foot`（美式 7 尺台，规格见 §2）

## 2. 常数表（默认值，可在 config 覆盖）

| 量 | 默认 | pooltool 对应 | 说明 |
|----|------|--------------|------|
| 台面（胶边内沿） | 1.9812 × 0.9906 m | `TableSpecs.seven_foot` | 美式 7 尺台 |
| 角袋口宽 | 0.11811 m | `corner_pocket_width` | v0 用圆判定区，半径=口宽/2 |
| 中袋口宽 | 0.136525 m | `side_pocket_width` | 同上 |
| 库边宽 | 0.0508 m | `cushion_width` | 渲染用；碰撞面即台面边界 |
| 球半径 R | 0.028575 m | `BallParams.R` | |
| 球质量 m | 0.170097 kg | `BallParams.m` | |
| 滑动摩擦 u_s | 0.2 | `u_s` | |
| 滚动阻力 u_r | 0.01 | `u_r` | |
| 自转衰减系数 u_sp | 0.0127（= 0.444·R） | `u_sp_proportionality = 10·2/5/9` | v1 启用（高低杆） |
| 球-球恢复系数 e_b | 0.95 | `e_b` | v0 恒定；速度相关后置 |
| 球-球摩擦 u_b | 0.05 | `u_b` | v2 启用（throw） |
| 库边恢复系数 e_c | 0.85 | `e_c` | v0 恒定 |
| 库边摩擦 f_c | 0.2 | `f_c` | v0 简化为切向保留系数 γ=0.9 |
| 重力 g | 9.81 m/s² | `g` | |
| 出杆速度映射 | power ∈ [0,1] → 0.5–8 m/s | — | 分段线性，端点可配 |
| 停球阈值 | v < 0.01 m/s 且 ω < 0.1 rad/s | — | 冻结为 stationary |
| 模拟 watchdog | 120 s（模拟时间） | — | 超时强制停球，防死循环 |

## 3. 运动状态机（两阶段摩擦）

每球状态：`stationary / spinning / sliding / rolling / pocketed`（与 pooltool 状态标签对齐，方便对拍）。

- **sliding**（接触点相对速度 u ≠ 0）：
  - v̇ = −u_s·g·û（û 为接触点相对滑动方向）
  - ω̇ = −(5·u_s·g)/(2R)·(ẑ×û)（自旋卷向自然滚动）
  - 切换条件：|u| → 0 进入 rolling
- **rolling**（自然滚动，v = R·(ẑ×ω)）：
  - v̇ = −u_r·g·v̂；ω 与 v 锁定
  - |v| 低于阈值 → spinning（若 ω_z ≠ 0）或 stationary
- **spinning**（原地自转，v≈0，ω_z≠0）：
  - ω̇_z = −(5·u_sp·g)/(2R)·sign(ω_z)（u_sp 为 0.444·R 折算）
  - v0 冻结此状态（spin=0 恒进 stationary）
- 内部 ω 用三分量向量（x,y,z），**v0 全冻结为 0；v1 解冻 x/y（高低杆，两阶段模型下跟球/缩球自然涌现）；v2 解冻 z（加塞+throw）**

## 4. 碰撞模型

### 4.1 球-球（v0）

等质量弹性碰撞 + 恢复系数，沿连心线：
- 法向相对速度按 e_b 反弹，切向分量不变（无 throw）
- 摩擦 u_b 留到 v2（Mathavan 模型参考 pooltool `physics/resolve/ball_ball/frictional_mathavan`）

### 4.2 球-库边（v0）

- 法向：v_n' = −e_c·v_n
- 切向：v_t' = 0.9·v_t（f_c=0.2 的简化折算，v2 换真实模型）
- v0 库边 = 台面矩形边界直线段（袋口开口处无库边）
- 真实 jaw 几何（pooltool 的 linear/circular cushion segments）留 v2；回放 schema 已预留 `pocket_jaw` 字段

### 4.3 球-袋口（v0）

- 圆形判定区：球心进入袋口圆（半径 = 口宽/2，圆心在袋口中心点）即 pocketed
- pocketed 球从桌面移除，记录进袋时刻与速度

## 5. 积分与求解（A' 方案）

**固定步长 dt = 1ms + 步内扫掠碰撞检测（CCD）**：

1. 每步开始，对全部运动球做扫掠检测：球-球解相对运动二次方程取最小正根 t*；球-库边、球-袋口同理
2. 取全桌最早事件时刻 t*，积分所有球到 t*，解算该碰撞
3. 剩余 dt−t* 重复（同一步内可能多次碰撞）
4. 无事件则整步积分

为什么不是纯事件驱动（pooltool 路线）：闭式解分段复杂度高，spin 加入后闭式解难写。为什么不是通用引擎：迭代求解器收敛漂移，确定性不可控。A' 是工程甜点位。

**确定性规则**：
- 同时碰撞按 `(t*, 球 id)` 排序后逐个解算
- 全部运算顺序固定，无并行
- 确定性域 = 同 engineVersion + 同 Node 大版本（V8 数学函数一致）；回放 meta 必记录二者

## 6. 求解器（research 用，不暴露给 Agent）

- `solve_pot(cue, object, pocket)`: 解析几何求最优瞄准角。v0 实现：切线法（ghost ball），参考 pooltool `ai.pot.calc_potting_angle`（该函数忽略 throw、不翻袋，与我们 v0 能力声明一致）
- `place_layout(seed, constraints)`: trial 布局生成（见 docs/hand-model.md §trial 协议）
- 这两个函数只存在于 core 的 research 视图，`--research` flag / 研究日志专用，**行协议与 Agent 视图永不暴露**

## 7. 测试与对拍

- **性质测试**（fast-check）：任意布局+动作下——总动能不增；任意 seed 下轨迹哈希一致；任意场景下最终全部停球
- **golden 对拍**（vitest）：`experiments/golden/*.json` 由 pooltool 生成（Python 3.13 uv 环境）：
  - 对拍场景 v0 限定：直线球、切角球、吃库反弹、进袋（pooltool 侧同样设 spin=0）
  - 容差：终态球位 < 5mm；进袋判定一致
  - 场景脚本与生成 notebook 入 `experiments/golden/`
- **轨迹哈希**：每 10ms 采样全球位 + 事件序列，定点 6 位小数序列化后 SHA-256。golden 测试与 CI 用

## 8. 参考资料

- Han (2005) *Dynamics in carom and three-cushion billiards*——两阶段摩擦模型
- Dr. Dave technical proofs：https://billiards.colostate.edu/technical_proofs/
- pooltool theory blog：https://ekiefl.github.io/2020/04/24/pooltool-theory/
- Leckie & Greenspan (2005) *An Event-Based Pool Physics Simulator*
- 本仓库 wheel 源码笔记：`/tmp/pt_probe`（临时，参数已抄录进 §2）

## 变更记录

- 2026-08-28 首次定稿
