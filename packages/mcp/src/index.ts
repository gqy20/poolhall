/**
 * @poolhall/mcp · MCP server 薄壳（M5）
 *
 * 工具面与 CLI 命令 1:1（docs/proto.md）。每进程独占一桌（每 stdio 会话一个 CalibSession）。
 * 手感由进程注入（泄漏红线：工具输出 = AgentView 白名单，绝不含 actual/bias/optimal）。
 */

export type { ServerOpts } from "./server.ts";
export { buildPoolhallMcp, startStdio } from "./server.ts";
export type { HistoryEntry, ObserveResult, ShotInput, ShotResult } from "./tools.ts";
export { ShotInputSchema, TOOL_META } from "./tools.ts";
export { MCP_VERSION } from "./version.ts";
