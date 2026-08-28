# 技术选型 · tech-stack

状态：已定稿（2026-08-28）
决策人：项目讨论定稿。变更需在文末"变更记录"追加说明。

## 1. 总原则

1. **CLI 先行，MCP/前端后置**——核心逻辑从第一天起就是纯库，壳只是换皮
2. **确定性是命根子**——物理核零依赖、零 I/O、零随机源，任何可能引入非确定性的东西都挡在 engine 包外
3. **能用内置不引第三方**——Node 内置模块优先，原生编译依赖 = 0
4. **zod schema 三端复用**——CLI 参数、JSONL 行协议、（未来的）MCP tool schema 共用同一份定义

## 2. 分包与依赖预算

pnpm workspaces（**不用 npm workspaces**，环境即 pnpm 10）：

```
poolhall/
├── pnpm-workspace.yaml     # packages: ["packages/*"]
├── packages/
│   ├── engine/    # 物理核。运行时依赖：0
│   ├── core/      # 局/规则/hand model/trial/日志。运行时依赖：zod + pure-rand
│   ├── cli/       # 薄壳。依赖：core、engine、commander、@clack/prompts、ansis
│   └── mcp/       # （后置）依赖 core + @modelcontextprotocol/server
└── experiments/   # Python/uv，不入 npm 依赖树
```

依赖预算（守住，扩容需记录理由）：

| 包 | 运行时依赖数 | 明细 |
|----|------------|------|
| engine | **0** | pure-rand 放 core 层 |
| core | **2** | zod v4、pure-rand |
| cli | **≤6** | commander、@clack/prompts、ansis、core、engine（+ 后续按需） |
| mcp（后置） | **≤3** | @modelcontextprotocol/server、core、engine |

## 3. 逐项选型（全部经 npm/PyPI 核实，2026-08-28）

| 层 | 选择 | 版本 | 核心理由 |
|----|------|------|---------|
| 运行时 | Node ≥ 26 | 26.7.0 | 原生 type-stripping（已验证 `node file.ts` 直跑）；`node:sqlite` 已验证可用 |
| 包管理 | **pnpm 10** | 10.33.2 | 环境既有；严格依赖隔离天然防止越层 import |
| 语言 | TypeScript，ESM-only | 最新 7.x | 全包 `"type":"module"` |
| 物理 | **自研**（固定步长 1ms + 扫掠碰撞解析） | — | 通用引擎（Rapier/matter/planck/Godot Physics）无跨版本确定性保证，且迭代求解器有收敛漂移；台球专用物理才是正解 |
| RNG | pure-rand | 8.4.2 | fast-check 同作者；计数器型 RNG 可按杆拆流（第 k 杆噪声 = f(seed, agent, k)，重算单杆不污染全局流） |
| Schema | zod v4 | 4.4.3 | Standard Schema 规范，未来 MCP tool schema 直接复用 |
| CLI 框架 | commander | 15.0.0 | 三层子命令嵌套（`poolhall experiment run`）强项；npm/git 系风格对 Agent 亲和 |
| 交互提示 | @clack/prompts | 1.7.0 | REPL 菜单/确认；比 inquirer 现代 |
| 终端渲染 | ansis | 4.3.1 | 零依赖、16m 色 |
| REPL | node:readline | 内置 | 行编辑/历史够用；ink 后置 |
| 持久化 | node:sqlite | 内置 | 会话/战绩/agent 身份；零原生编译 |
| 测试 | vitest | 4.1.11 | 单测+快照；与 ESM 原生契合 |
| 性质测试 | fast-check | 4.9.0 | 物理不变量测试范式（能量不增、任意 seed 一致） |
| Lint/格式 | @biomejs/biome | 2.5.11 | 单工具替代 eslint+prettier |
| 构建 | tsdown | 0.22.14 | 仅 cli/mcp 发布用；engine/core 源码直接消费 |
| LLM 调用 | 裸 fetch（Week 1） | — | OpenAI/Anthropic 兼容端点；AI SDK 后置 |

### 弃用记录

| 候选 | 弃用理由 |
|------|---------|
| npm workspaces | 环境标准是 pnpm，pnpm 的严格 node_modules 隔离还免费送"越层 import 防护" |
| Rapier2D (WASM) | 确定性声明仅限同一二进制内；刚体求解器迭代有收敛漂移 |
| matter-js / planck | 娱乐向摩擦/恢复系数模型；迭代求解器非确定性 |
| better-sqlite3 | 原生编译摩擦；node:sqlite 已够用 |
| cac | 7.0 已 4 年未更新 |
| seedrandom | 8 年未更；无计数器模式 |
| Godot 内置物理 / GDScript 写物理 | 无跨版本确定性、测试生态弱、阻塞 stdin；Godot 定位为纯回放渲染器（见 docs/adr 目录待补） |
| inspect-ai / litellm（TS 主链路） | harness 用 TS 行协议即可；Python 侧只做出图 |

## 4. 外部依赖（不入依赖树）

| 依赖 | 用途 | 说明 |
|------|------|------|
| pooltool-billiards 0.6.0 | golden 对拍 oracle | Python 3.10–3.13（uv 独立环境）；其 `ai.pot.calc_potting_angle` / `ai.aim.at_ball` 是我们 `solve_pot()` 参考实现 |
| matplotlib（Python） | 知行曲线等实验出图 | uv 管理，experiments/ 独立 |

## 5. 工具链约定

- Node ≥ 26、pnpm ≥ 10、Python 3.13（仅实验）、uv
- CI 最小闭环：`pnpm lint` → `pnpm test` → 确定性红线扫描（engine 包文本扫描 `Math.random|Date.now|performance.now|fetch|node:fs|process.env`）
- 提交规范见 AGENTS.md §4

## 变更记录

- 2026-08-28 首次定稿
