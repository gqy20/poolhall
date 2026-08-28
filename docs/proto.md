# 行协议与回放格式 · proto

状态：草稿（2026-08-28）——**schema 定稿前不下 v0.1.0**；一旦定稿，破坏性变更必须升 schema 版本并迁移旧文件。

本文件定义两个契约：
1. **行协议**（`--driver external` 的 stdin/stdout JSONL）——Agent 与壳的活接口
2. **回放格式**（`.phl` 事件日志）——确定性回放的持久契约，也是未来 Godot 前端的唯一输入

## 1. 行协议（JSONL，UTF-8，每行一个 JSON 对象）

### 1.1 服务 → Agent（stdout）

```jsonc
// 开局：桌况 + 规则 + 你的身份（agent 视图，绝无 bias/actual）
{"type":"hello", "schema":1, "mode":"calibrate", "perception":"A",
 "agent":"pi-sonnet", "table":{"width":1.9812,"height":0.9906},
 "balls":[{"id":"cue","x":0.5,"y":0.5,"color":"white"},{"id":"1","x":1.2,"y":0.3,"color":"yellow"}],
 "pockets":[{"id":"lt","x":0,"y":0,"r":0.059}], "shotBudget":20}

// 每杆之后：结果观察（agent 视图）
{"type":"observation", "shot":7,
 "events":[{"t":0.42,"kind":"ball-ball","a":"cue","b":"3"},
           {"t":0.61,"kind":"pocket","ball":"3","pocket":"rt"}],
 "balls":[{"id":"cue","x":0.8,"y":0.2}],
 "score":{"potted":["1","3"],"remaining":6},
 "shotResult":"pot"}   // pot | miss | foul | illegal

// 结束
{"type":"end", "reason":"budget", "score":14}
```

### 1.2 Agent → 服务（stdin）

```jsonc
{"type":"shot", "angle":35.0, "power":0.6, "spin":0.0,
 "prediction":{"hitBall":"3","targetPocket":"rt","cueAfter":"two cushions back to center"}}
```

- `angle`：度，瞄准方向（0=+x，逆时针为正）
- `power`：[0,1]；`spin`：[-1,1]，v0 必须为 0（非 0 报校验错）
- `prediction`：v0 可选自由文本 + 结构化字段，v1 强制
- 非法输入返回 `{"type":"error","code":2,"msg":"..."}` 并等待重发

### 1.3 校验

zod schema（core 包 `proto.ts`）双端共用；CLI 侧、未来 MCP 侧同一份。

## 2. 回放格式（.phl，JSONL）

**回放不需要 RNG 重放**——所有噪声结果已物化在实际轨迹里，逐事件记录即可：

```jsonc
{"type":"meta", "schema":1, "engineVersion":"0.1.0", "nodeVersion":"26.7.0",
 "seed":42, "agent":"pi-sonnet", "handModel":{"bias":-1.2,"angleSigma":0.3,"powerSigma":0.05},
 "table":"seven_foot", "mode":"calibrate", "createdAt":"..."}   // createdAt 仅记录用，不参与回放

{"type":"layout", "shot":0, "balls":[{"id":"cue","x":0.5,"y":0.5},...]}

{"type":"shot", "shot":7, "intent":{"angle":35.0,"power":0.6},
 "actual":{"angle":33.8,"power":0.58},       // research 字段：benchmark 输入禁止读取
 "prediction":{...}}

{"type":"event", "shot":7, "t":0.42, "kind":"ball-ball", "a":"cue","b":"3",
 "pos":{"cue":[0.71,0.44],"3":[0.77,0.44]}}

{"type":"sample", "shot":7, "t":0.30, "pos":{"cue":[0.55,0.41],"3":[1.2,0.3]}}  // 每 10ms
{"type":"sample", "shot":7, "t":0.31, "pos":{...}}

{"type":"end", "shot":7, "balls":[...终态], "score":{...}}
```

- `sample` 每 10ms 全球位（渲染与轨迹哈希的原料）；`event` 是碰撞/进袋/停球离散事件
- **agent 视图回放**（观战分发用）：过滤掉 `shot.actual` 与 `meta.handModel` 的版本
- 轨迹哈希 = 对全部 sample+event 序列（6 位小数）做 SHA-256，写在 meta 尾记录 `{"type":"hash"}`

## 3. 字段预留（前向兼容）

- `pocket_jaw`：真实袋口 jaw 几何（v2 物理升级时启用，不破坏 schema 1）
- `spin` 全量启用、`throw` 事件
- 对弈模式：`actor` 字段（当前出杆方）

## 4. 禁止事项（泄漏红线）

- 行协议任何输出不得含 `actual` / `bias` / `optimal`
- `.phl` 的 research 字段只在 `--research` 导出时写入；默认导出（观战/分享）剔除
- Godot 前端消费的是**默认导出**（无 research 字段），从源头杜绝观战泄漏

## 5. 变更流程

schema 版本号只增不减。破坏性变更：升版本 → 写迁移脚本（`poolhall migrate old.phl`）→ golden 测试更新。见 AGENTS.md §7。

## 变更记录

- 2026-08-28 草稿（待实现中验证后定稿）
