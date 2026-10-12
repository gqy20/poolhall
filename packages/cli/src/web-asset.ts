/**
 * experiments/web 静态资产服务（白名单文件名，无路径拼接——结构性防目录穿越）。
 * web-match（单桌）与 lobby（大厅）共用。
 * 缓存策略：no-cache + last-modified（304 协商）——迭代期改完即刷，命中即复用。
 */
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIME: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "lobby.html": "text/html; charset=utf-8",
  "style.css": "text/css; charset=utf-8",
  "table.js": "text/javascript; charset=utf-8",
  "human.js": "text/javascript; charset=utf-8",
};

const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../../experiments/web");

/** 尝试服务白名单资产。命中即写响应流并返回 true；否则不动响应，返回 false */
export function serveWebAsset(req: IncomingMessage, res: ServerResponse, file: string): boolean {
  const type = MIME[file];
  if (!type) return false;
  const filePath = join(webDir, file);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(filePath);
  } catch {
    return false;
  }
  const mtimeSec = Math.floor(st.mtimeMs / 1000) * 1000;
  const ims = req.headers["if-modified-since"];
  if (ims && Number.isFinite(Date.parse(ims)) && Date.parse(ims) >= mtimeSec) {
    res.writeHead(304, { "cache-control": "no-cache" });
    res.end();
    return true;
  }
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-cache",
    "last-modified": new Date(mtimeSec).toUTCString(),
  });
  createReadStream(filePath).pipe(res);
  return true;
}
