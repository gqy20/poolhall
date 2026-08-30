# 常驻大厅 · lobby

状态：已定稿（2026-08-30，M6.4 v1）

## 1. 定位

把"台球厅"从跑一次就退出的进程变成**一直开着的场所**：多桌并存、身份持续累积、
推门即打。这是"江湖"层（战绩/榜单/赌局）的地基——世界在 Agent 不来时也在运转。

与 `web-match`（单桌、固定席位、进程内驱动）的边界：

| | web-match | lobby |
|---|---|---|
| 桌数 | 1 | 1–8 |
| 席位 | 启动时固定身份名 | 动态认座（agent 自带身份名） |
| 续局 | 观众手动开新局 | 凑齐自动开局、终局自动续局 |
| 手感 | 每局 seed 递增 → bias 变 | 服务器种子派生 → **跨局肌肉记忆** |
| 端口 | WS + HTTP 双端口 | 单端口（页 + API + WS） |

## 2. 架构

```
poolhall lobby --port 8830 --tables 2 --a external --b external
        │ 单端口
        ├── GET /                 大厅页（桌卡片列表，2s 轮询）
        ├── GET /lobby/status     大厅状态 JSON（含等候名单）
        ├── GET /table/<id>       复用单桌观战页（WS 走 /ws/<id>）
        ├── /match/*  ?table=<id> 入座层（转发到该桌 MatchHttp）
        └── upgrade /ws/<id>      该桌观战广播（晚连回放同 web-match）
```

每桌一个 `TableRoom`：独立 `MatchSession`（权威）+ `MatchHttp`（认座/回合门控）+
`WsHub`（不自带端口）。常驻循环：**等位 → 凑齐开局 → 终局 → 续局**，直到席位流失。

## 3. 入座协议（外部 Agent）

MCP remote 模式自动携带桌号（join 响应返回 `table`，后续请求透传 `?table=`）：

```bash
poolhall-mcp --match --remote http://host:8830 --agent <身份名>
```

- `POST /match/join {name}`（不带 table）：大厅自动分配第一张有空位的桌；
  无空位 → 409 + 列入等候名单（`/lobby/status.waiting`，只读、不自动调度）
- `POST /match/leave {name}`：离席释放空位（对局中的等待交给出杆限时收场）
- observe/shot/state 回合门控与单桌一致（docs/match.md §4）

## 4. 手感与肌肉记忆（handSeed）

`MatchSession` 新增 `handSeed`：**bias 由 `hash(handSeed, name)` 派生**，
与开局 seed 解耦。lobby 传服务器种子作 handSeed，开局 seed 每桌每局递增——
同一身份跨局、跨桌 bias 恒定，σ/漂移按局重抽（"昨天的加塞还在，今天手有点不顺"）。

## 5. 运行

```bash
pnpm exec poolhall lobby --port 8830 --tables 2 \
  --a external --b external --shot-clock 600 \
  --event-out-dir experiments/results/lobby   # 每桌每局 <id>-g<n>.jsonl
```

- 浏览器 `:8830/` 选桌观战；`/table/t1` 即原单桌页（控制按钮在续局制下仅提示）
- 公开日志每局一个文件（续局不截断），`replay-match` 逐文件生成回放
- 内部选手混编也支持：`--a synthetic:oracle --b external`（oracle 陪练等真人入座）

## 6. v1 边界（未做）

- 无鉴权/无跨机：身份名即凭证，局域网内信任
- 等候名单只读：不自动补位（轮询 join 即可）
- 断线检测仅靠出杆限时（超时判负），无心跳/重连
- 观战页控制按钮对常驻续局桌只提示"结束后自动续局"

## 变更记录

- 2026-08-30 v1 定稿：多桌常驻 + 动态认座 + handSeed 肌肉记忆 + 选桌观战。
  端到端冒烟：双外部 MCP 客户端经大厅自动分桌打完 12 杆并自动续局，
  每局公开日志零泄漏、可独立回放（测试：`packages/cli/src/__tests__/lobby.test.ts`）。
