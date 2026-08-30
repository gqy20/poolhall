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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { type MatchEvent, parsePublicMatchEvent } from "@poolhall/core";

interface Socket {
  send(data: string): void;
  close(): void;
}

export interface HubControl {
  type: "new_match";
  maxShots: number;
}

export type HubNotice =
  | {
      type: "control";
      state: "starting" | "thinking" | "playing" | "ready" | "busy" | "error";
      message: string;
      actor?: "A" | "B";
    }
  | { type: "control"; state: "connected"; message: string; maxShots: number };

const SOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 极简 WebSocket server（基于 Node net/http）——握手 + 帧解析 + 广播 */
export class WsHub {
  private clients = new Set<Socket>();
  private controlHandlers = new Set<(control: HubControl) => void>();
  private lastNotice: HubNotice | null = null;
  private server: Server | null = null;
  /** 新客户端连接时回放历史——解决"客户端晚到"时序错位 */
  readonly history: MatchEvent[] = [];
  readonly port: number;
  readonly host: string;

  constructor(port: number, host = "0.0.0.0") {
    this.port = port;
    this.host = host;
  }

  broadcast(msg: MatchEvent): void {
    const event = parsePublicMatchEvent(msg);
    this.history.push(event);
    const data = JSON.stringify(event);
    for (const c of this.clients) c.send(data);
  }

  notify(notice: HubNotice): void {
    this.lastNotice = notice;
    const data = JSON.stringify(notice);
    for (const client of this.clients) client.send(data);
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  onControl(handler: (control: HubControl) => void): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }

  async close(): Promise<void> {
    for (const c of this.clients) c.close();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** 启动 http server；upgrade 时切到 ws 协议 */
  start(): Promise<void> {
    if (this.server) throw new Error("WebSocket hub 已启动");
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("PoolHall ws hub — connect via WebSocket\n");
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server = null;
        reject(error);
      };
      server.once("error", onError);
      server.on("upgrade", (req, sock: Duplex) => this.handleUpgrade(req, sock));
      server.listen(this.port, this.host, () => {
        server.off("error", onError);
        resolve();
      });
    });
  }

  boundPort(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") throw new Error("WebSocket hub 尚未监听");
    return address.port;
  }

  private handleUpgrade(req: IncomingMessage, sock: Duplex): void {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      sock.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(key + SOCKET_GUID)
      .digest("base64");
    sock.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let sock2: Socket;
    sock2 = makeSocket(
      sock,
      (text) => this.handleClientText(text),
      () => this.clients.delete(sock2),
    );
    this.clients.add(sock2);
    // 回放历史：解决"客户端晚到"（跑完 match 后才连进来）
    for (const msg of this.history) sock2.send(JSON.stringify(msg));
    if (this.lastNotice) sock2.send(JSON.stringify(this.lastNotice));
  }

  private handleClientText(text: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object" || !("type" in payload)) return;
    if (payload.type !== "new_match" || !("maxShots" in payload)) return;
    const maxShots = Number(payload.maxShots);
    if (!Number.isInteger(maxShots) || maxShots < 1 || maxShots > 120) return;
    for (const handler of this.controlHandlers) handler({ type: "new_match", maxShots });
  }
}

/** 帧写入器：仅实现服务端→客户端文本帧；客户端帧当前直接丢弃。 */
function makeSocket(sock: Duplex, onText: (text: string) => void, onClose: () => void): Socket {
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

  readClientFrames(sock, onText);
  sock.on("close", onClose);
  sock.on("error", onClose);
  return { send, close };
}

/** 浏览器控制帧解析：支持 masked text、close；控制消息限制为 64KiB。 */
function readClientFrames(sock: Duplex, onText: (text: string) => void): void {
  let pending = Buffer.alloc(0);
  sock.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0]! & 0x0f;
      const masked = (pending[1]! & 0x80) !== 0;
      let length = pending[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        const wide = pending.readBigUInt64BE(2);
        if (wide > 65536n) return sock.destroy();
        length = Number(wide);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (length > 65536 || pending.length < offset + maskBytes + length) return;
      const mask = masked ? pending.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(
        pending.subarray(offset + maskBytes, offset + maskBytes + length),
      );
      pending = pending.subarray(offset + maskBytes + length);
      if (mask) {
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
      }
      if (opcode === 0x1) onText(payload.toString("utf8"));
      if (opcode === 0x8) return sock.end();
    }
  });
}
