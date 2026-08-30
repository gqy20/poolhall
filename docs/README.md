# 设计文档索引

| 文档 | 内容 | 状态 |
|------|------|------|
| [tech-stack.md](tech-stack.md) | 技术选型、分包与依赖预算、工具链 | 已定稿 |
| [physics.md](physics.md) | 物理核规格：常数表、碰撞模型、积分方案、确定性、对拍 | 已定稿 |
| [hand-model.md](hand-model.md) | 手感系统：噪声公式、默认参数、RNG 流、防泄漏红线 | 已定稿 |
| [cli.md](cli.md) | CLI 命令面、REPL、实验 harness、出图规范 | 已定稿 |
| [proto.md](proto.md) | 行协议（JSONL）与回放格式（.phl）契约 | 草稿（实现期验证） |
| [benchmark.md](benchmark.md) | 校准挑战协议、信噪比公理与准入门（2×50 杆实证） | 已定稿 |
| [clear.md](clear.md) | 清台挑战：9 球计分赛规则、scratch 威慑、aimAssists | 已定稿（M6.1） |
| [match.md](match.md) | 中式八球对局：v1 规则、双选手 hand model、Agent vs Agent | 已定稿（M6.2） |
| [roadmap.md](roadmap.md) | 里程碑 M0–M6、每阶段完成定义（DoD）、节奏与止损线 | 已定稿 |

产品设计上下文见根目录 [PRODUCT.md](../PRODUCT.md)：观战用户、产品定位、品牌性格、反例与无障碍基线。

规范类见根目录 [AGENTS.md](../AGENTS.md)；项目愿景见 [README.md](../README.md)。

阅读顺序建议：README → AGENTS → tech-stack → physics → hand-model → cli → proto。
