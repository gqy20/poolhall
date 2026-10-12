/**
 * experiments/web 静态资产服务（白名单文件名，无路径拼接——结构性防目录穿越）。
 * web-match（单桌）与 lobby（大厅）共用。
 */
import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
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
export function serveWebAsset(res: ServerResponse, file: string): boolean {
  const type = MIME[file];
  if (!type) return false;
  try {
    statSync(join(webDir, file));
  } catch {
    return false;
  }
  res.writeHead(200, { "content-type": type });
  createReadStream(join(webDir, file)).pipe(res);
  return true;
}
