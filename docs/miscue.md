# Mis-cue 概率模型（设计文档，未实现）

状态：v0 设计稿（2026-08-29）

## 1. 现状与动机

v1+v2 hand model（packages/core/src/hand.ts）：
```
epsAngle  ~ N(0, 0.05°)         小角度偏差
epsPower  ~ N(0, 0.05)           力度偏差
```

**缺失**：mis-cue（杆头擦到球边）这一类**接触失败的离散事件**。当前系统对每杆要么"正中"要么"小角度偏差"——真实台球里：
- 杆头擦球上偏下 → 出杆角严重偏离 + 力度衰减
- 挥杆失力（lasso）→ 力度 30-50% 严重不足
- 击球点不正（thrust）→ 母球自转分量错位

这些是**真实台球的常见失误源**，但**对当前校准任务不一定必要**——v9.2 进球 78% 已经稳定。

## 2. 实现层级（按性价比）

| 层级 | 实现 | 真实性 | 何时用 |
|------|------|--------|-------|
| **A. 概率触发** | 每杆 p≈3% 触发"划边"：力度 ×0.3、角度 σ ×5、spin 重洗。50 行。 | 低（无瞄准错位物理） | 当想给补偿回路更多真实信号时 |
| **B. 几何擦边** | 杆头椭圆 vs 球面，瞄点偏心 → 真实切线分量传播。半日。 | 中-高 | 当想真模拟"打偏了"的几何效果时 |
| **C. 多维度 miscues** | A+B 加 lasso/thrust 概率分布。1-2 日。 | 高 | 全面手感建模 |

**当前推荐**：先不实现。v9.2 校准任务已稳定；miscue 加进来会让进球率方差变大、prompt 工程重做。

## 3. 真实手感的概率 vs 偏差模型

| 失误类型 | 概率 | 物理后果 |
|---------|------|---------|
| 完美击球 | ~85% | normal applyHand |
| 擦球边 | ~10% | 角大偏（5°+）、力度 ×0.5、spin 重洗 |
| 杆头脱靶（miss-shot）| ~4% | 出杆无接触（vel = 0、w = 0） |
| 失力（lasso）| ~1% | 力度 ×0.3，方向正常 |

按 50 杆算：5 杆 miscues ≈ 7 颗 miss。3 杆 v9.2 = 4 颗 miss。

## 4. 集成设计

在 `core/src/hand.ts::applyHand` 前加一个 `miscue` 层：

```ts
function applyHand(intent, noise, miscues) {
  // 先 applyHand 正常
  // ...
  // 再叠加 miscues（独立事件）
  if (miscues.scratched) actual.power *= 0.3;
  if (miscues.aimDrift) actual.angle += uniform(±5°);
  if (miscues.missShot) { actual.power = 0; actual.angle = 0; }
  return actual;
}
```

`Miscues` 用 LLM 模型驱动（基于 strike 参数 + seed），与 hand noise 一样确定性可复现。

## 5. v0 设计稿的依据

- pooltool 物理模型的 `ball_cushion_friction` 系数（间接反映擦球）
- Leckie & Greenspan (2005) 离散事件台球仿真
- 真人台球教学："碰偏了"比"瞄偏了"常见得多

## 6. 上线时间表

- v0：文档（本文，2026-08-29）
- v0.1：当 v9.2 4-seed 验证有≥7pp 方差触发需求时，上 A 方案（约 1 小时）
- v1.0：换官方端点 + 多模型对比后，上 B 方案（半天）

## 变更记录

- 2026-08-29 v0 设计稿
