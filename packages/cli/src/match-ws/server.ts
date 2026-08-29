/**
 * WebSocket 服务器（零依赖：Node 内置 http + ws 协议手写）
 *
 * 协议：每条 JSON 消息形如
 *   { "type": "hello", "seed", "nameA", "nameB" }
 *   { "type": "shot",   "trial", "by", "targetBall", ..., "samples", "events" }
 *   { "type": "summary", "winner", "reason", "shots" }
 *
 * 浏览器侧：new WebSocket("ws://host:8787") + JSON.parse
 *
 * 用法：startWsServer(8787) 返回 { broadcast(msg) }
 *   每次广播后所有连接 client 收到该 JSON
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

interface Socket {
  send(data: string): void;
  close(): void;
}

interface HelloMsg {
  type: "hello";
  seed: number;
  nameA: string;
  nameB: string;
  promptA: string | null;
  promptB: string | null;
}

export type Broadcast =
  | HelloMsg
  | {
      type: "shot";
      trial: number;
      by: "A" | "B";
      targetBall: string | null;
      targetPocket: string | null;
      intentAngle: number | null;
      intentPower: number | null;
      intentSpin: { x: number; y: number; z: number } | null;
      pottedBalls: string[];
      pottedPockets: Array<{ ball: string; pocket: string }>;
      scratch: boolean;
      firstContact: string | null;
      foul: string | null;
      nextTurn: "A" | "B";
      over: boolean;
      winner: "A" | "B" | null;
      reason: string | null;
      /** 完整轨迹（10ms 采样）——浏览器按时间戳内插出平滑移动 */
      samples: Array<{ t: number; pos: Record<string, { x: number; y: number }> }>;
      cueFinal: { x: number; y: number } | null;
      finalBalls: Record<string, { x: number; y: number }>;
    }
  | {
      type: "summary";
      winner: "A" | "B" | null;
      reason: string | null;
      shots: number;
    };

const SOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 极简 WebSocket server（基于 Node net/http）——握手 + 帧解析 + 广播 */
export class WsHub {
  private clients = new Set<Socket>();
  /** 新客户端连接时回放历史——解决"客户端晚到"时序错位 */
  readonly history: Broadcast[] = [];
  readonly port: number;
  readonly host: string;

  constructor(port: number, host = "0.0.0.0") {
    this.port = port;
    this.host = host;
  }

  broadcast(msg: Broadcast): void {
    this.history.push(msg);
    const data = JSON.stringify(msg);
    for (const c of this.clients) c.send(data);
  }

  close(): void {
    for (const c of this.clients) c.close();
    this.clients.clear();
  }

  /** 启动 http server；upgrade 时切到 ws 协议 */
  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("PoolHall ws hub — connect via WebSocket\n");
      });
      server.on("upgrade", (req, sock: Duplex) => this.handleUpgrade(req, sock));
      server.listen(this.port, this.host, () => resolve());
    });
  }

  private handleUpgrade(req: IncomingMessage, sock: Duplex): void {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      sock.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + SOCKET_GUID).digest("base64");
    sock.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const sock2 = makeSocket(sock);
    this.clients.add(sock2);
    // 回放历史：解决"客户端晚到"（跑完 match 后才连进来）
    for (const msg of this.history) sock2.send(JSON.stringify(msg));
  }
}

/** 帧解析器：仅实现服务端→客户端文本帧（广播用）+ ping/pong */
function makeSocket(sock: Duplex): Socket {
  const send = (data: string): void => {
    const payload = Buffer.from(data, "utf8");
    // 单帧，mask=0，opcode=1（text）
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      sock.write(Buffer.concat([header, payload]));
    } catch {
      /* 断开 */
    }
  };
  const close = (): void => {
    try {
      sock.write(Buffer.from([0x88, 0x00]));
      sock.end();
    } catch {
      /* noop */
    }
  };

  // 简化：丢弃 client→server 帧（不读 ping/pong）。生产应实现。
  sock.on("data", () => {});
  sock.on("close", () => {});
  sock.on("error", () => {});
  return { send, close };
}
