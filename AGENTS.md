# AGENTS.md · 协作规范

本仓库的 Agent 协作守则。任何智能体（或人）在此仓库工作前必读。
与 README.md（愿景）互不替代；冲突时以本文件为准。

## 0. 一句话宪法

> 物理永远精确，人类的不完美只住在注入层，隐藏状态永远只在服务侧。

任何改动若违反此条，先停下来在 issue 里说明理由，获准前不写代码。

## 1. 仓库分层与依赖方向

```
packages/engine    物理核：纯库、零依赖、零 I/O、确定性
packages/core      局/规则/hand model/trial 协议/事件日志：纯库，依赖 engine
packages/cli       薄壳：REPL/批量回放/调试/实验入口，依赖 core+engine
packages/mcp       （后置）MCP server 薄壳，与 cli 同级，依赖 core
experiments/       Python/uv：跑实验出图，直接调 core 产物或行协议
godot/             （后置）纯回放渲染器，只消费事件日志 JSONL
docs/              设计文档
```

依赖只能自上而下（cli → core → engine）。**反向依赖、跨层 import 一律禁止**。
engine 永远不 import core/cli/mcp；core 永远不 import cli/mcp。

## 2. 代码规范

### 2.1 文件体量

| 项 | 上限 | 说明 |
|----|------|------|
| 单文件行数 | **1000 行** | 超过即拆分。物理模块按碰撞类型拆（ball-ball / ball-cushion / ball-pocket） |
| 单函数行数 | **60 行** | 演示/测试代码可放宽至 100 |
| 单测试文件 | 500 行 | 测试按主题分文件 |

拆分原则：按职责拆，不按"长"拆。一个 900 行文件若职责单一清晰，说明抽象错了层，不是"行数还够"。

### 2.2 命名

- **文件名：小写 kebab-case，5–10 个字符**（不含扩展名）。
  - ✅ `resolve.ts` `hand-mod.ts` `render.ts` `trial.ts` `cli.ts`
  - ❌ `ballBallCollisionResolverImplementation.ts` `physics-engine-core-utils.ts`
  - 音节过短导致歧义时允许例外（`vec2.ts` `solve.ts`），但不超过 12 字符
- 类型/类：PascalCase；函数/变量：camelCase；常量 UPPER_SNAKE
- 物理量命名与 pooltool 对齐：`u_s`（滑动摩擦）`u_r`（滚动摩擦）`e_b`（球-球恢复系数）`e_c`（库边恢复系数）`f_c`（库边摩擦）`R`（球半径）`m`（质量）——全库统一，不发明同义词
- 脚本即命令的文件，名字就是命令名的一部分。短名字 = 低 token 成本 = Agent 亲和

### 2.3 TypeScript 风格

- ESM-only（`"type":"module"`），Node 26 原生 type-stripping，dev 零编译
- 严格模式（`strict: true`），导出函数显式返回类型
- 错误处理：engine/core 抛 `Error` 子类（如 `PhysicsError`），不返回 null 不吞错
- 模块只导出必要 API；engine 内部实现不跨包导出
- 导入路径用相对路径，不用路径别名（保持可移植）

### 2.4 确定性红线

`packages/engine` 内禁止出现以下任何一项，CI 强制扫描（脚本扫源码文本即可）：
- `Math.random()` `Date.now()` `performance.now()`
- `fetch` / `node:fs` / 网络 / `process.env`
- 依赖迭代顺序的逻辑（迭代必须先按稳定键排序）
- 任何第三方运行时依赖（engine 的 `dependencies` 必须为空数组）

**确定性红线检查清单（每次涉及 engine 的改动自检）**
- [ ] 新代码路径无随机源/时钟/I/O
- [ ] 碰撞同时发生时按球 id 排序消解，顺序稳定
- [ ] 同 seed + 同动作序列 → 轨迹哈希不变的测试仍然全绿
- [ ] golden 对拍文件未被静默更新（更新必须显式说明物理行为变更）

## 3. 测试规范

- 测试框架 vitest，性质测试用 fast-check
- **每个物理模块必须配性质测试**：能量不增、动量合理、任意 seed 哈希一致
- **golden 对拍**：`experiments/golden/` 存 pooltool 生成的参考轨迹，engine 改动必须全绿
- 快照测试用于：模式 B 描述器输出、ASCII 渲染器输出
- 测试文件放被测文件同目录 `__tests__/`，命名 `*.test.ts`
- 提交前必须全绿：`pnpm test`（根脚本聚合所有包）

## 4. Git 与提交

- 提交信息格式：`type(scope): subject`，subject 可中文
- type：feat/fix/refactor/docs/test/chore/perf
- scope：engine/core/cli/mcp/docs/exp
- 提交前跑 `pnpm lint`（biome）与 `pnpm test`
- 禁止提交生成物（dist/、*.phl 回放）；golden 数据除外——它是有意的快照

## 5. Agent 协作协议

- **先读后写**：动任何文件前先 `read` 全文，禁止凭记忆编辑
- **最小改动**：只改任务要求的文件；顺手重构必须单独立项
- **多工具并行**：独立调用用并行块，禁止流水线式串行等待
- **中文优先**：文档、注释、提交信息中文；代码标识符英文
- **不问不猜**：需求含糊时先问，不做"我觉得应该"的实现

## 6. 命令速查

```bash
pnpm test            # 全部测试（engine/core/cli）
pnpm lint            # biome check --write（全部包）
pnpm -F engine test  # 单包测试
pnpm -F cli build    # cli 构建（发布用）
node packages/engine/src/sim.ts        # dev 直跑 TS（type-stripping）
node --watch packages/engine/src/sim.ts # watch 模式开发循环
```

## 7. 文档维护

- 本目录每份文档头部有"状态"标记：`草稿/评审中/已定稿/已废弃`
- 破坏性决策（如冻结回放格式）需在相关文档追加"变更记录"段
- 新增顶层文档需同步更新 `docs/README.md` 索引
