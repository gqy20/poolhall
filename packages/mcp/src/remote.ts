/**
 * 远程对局客户端（M6.3：外部 Agent 经 HTTP 入座）
 *
 * remote 模式的 MCP server 只是一层代理——权威对局在 web-match 服务端
 * （MatchHttp，回合门控在那里）。本客户端负责 HTTP 往返与错误包装：
 * 409（没轮到你/对局结束）是正常流程态，由调用方转成工具文本给 Agent 读。
 */

export interface RemoteJoinResult {
  ok: boolean;
  seat: "A" | "B";
  seats: { A: string | null; B: string | null };
  shotClockMs: number;
  /** 大厅模式：分到的桌号（后续请求自动携带；单桌模式无此字段） */
  table?: string;
}

export interface RemoteShotArgs {
  aimX: number;
  aimY: number;
  power: number;
  spin?: { x: number; y: number; z: number };
  targetBall: string;
  targetPocket: string;
  prediction?: string;
  /** 完整公开计划（AI 内心戏）：透传观战面板 */
  plan?: {
    observation: string;
    choice: string;
    cuePlan: string;
    risk: string;
    confidence: "low" | "medium" | "high";
  };
}

/** HTTP 非 2xx：payload 为服务端 JSON 错误体（含 error/turn 等） */
export class RemoteMatchError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`远程对局请求失败（HTTP ${status}）`);
    this.status = status;
    this.payload = payload;
  }
}

export class MatchRemoteClient {
  readonly baseUrl: string;
  readonly name: string;
  /** 大厅入座后分到的桌号；后续请求自动携带 */
  table: string | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, name: string, fetchFn: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.name = name;
    this.fetchFn = fetchFn;
  }

  /** 入座：单桌校验身份名，大厅自动分配空桌（响应携带 table） */
  async join(): Promise<RemoteJoinResult> {
    const result = (await this.request("POST", "/match/join", {
      name: this.name,
    })) as RemoteJoinResult;
    this.table = result.table ?? null;
    return result;
  }

  /** 离席（大厅空位回收） */
  leave(): Promise<unknown> {
    return this.request("POST", this.withTable("/match/leave"), { name: this.name });
  }

  /** 公开对局状态（轮次/比分/等待谁）——随时可查 */
  state(): Promise<unknown> {
    return this.request("GET", this.withTable("/match/state"));
  }

  /** 当前选手视角观察（仅轮到自己时 200，否则 409） */
  observe(): Promise<unknown> {
    return this.request(
      "GET",
      this.withTable(`/match/observe?name=${encodeURIComponent(this.name)}`),
    );
  }

  /** 出杆（仅轮到自己时受理，否则 409） */
  shot(args: RemoteShotArgs): Promise<unknown> {
    return this.request("POST", this.withTable("/match/shot"), { ...args, name: this.name });
  }

  /** 读对手（心理层）：提交对对手习惯偏差的估计（度），服务端带噪声评分、限次 */
  read(estimateDeg: number, rationale?: string): Promise<unknown> {
    return this.request("POST", this.withTable("/match/read"), {
      name: this.name,
      estimateDeg,
      ...(rationale ? { rationale } : {}),
    });
  }

  /** 大厅模式追加 ?table= 参数 */
  private withTable(path: string): string {
    if (!this.table) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}table=${encodeURIComponent(this.table)}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) throw new RemoteMatchError(res.status, data);
    return data;
  }
}
