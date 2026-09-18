#!/usr/bin/env node
/**
 * 清理遗留的 poolhall 服务进程（lobby / web-match）。
 *
 * 为什么不用 pkill：
 *   1. `pkill -f "poolhall web-match"` 会匹配到执行它的 shell 自身（命令行里含该字面量），
 *      把调用方一起杀掉，后续清理步骤静默丢失；
 *   2. `pnpm exec` 的包装进程不转发 SIGTERM 给 node 子进程，杀包装层只会把真进程
 *      留成占端口的孤儿。
 *
 * 所以这里解析 /proc/<pid>/cmdline 的 **argv 结构**判定进程身份，只认 node 本体与 pnpm
 * 包装层，绝不做全命令行子串匹配；再显式排除自身与祖先后，先 TERM 后 KILL，最后复扫确认。
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

/** 需要清理的子命令 */
const TARGETS: readonly string[] = ["lobby", "web-match"];

interface Proc {
  pid: number;
  ppid: number;
  argv: string[];
}

/** 进程类别：node 本体 / pnpm 包装层 / 无关 */
export type ProcKind = "node" | "wrapper" | null;

/**
 * 判定 argv 是否为 poolhall 服务进程。
 *
 * 只看 argv[0] 的可执行名与紧随脚本名的子命令，不做全行子串匹配——否则一个正在
 * `grep "cli/src/main.ts lobby"` 的终端会被当成目标误杀（真实踩过的坑）。
 */
export function classify(argv: string[]): ProcKind {
  const exe = basename(argv[0] ?? "");
  const isTarget = (s: string | undefined): boolean => TARGETS.includes(s ?? "");

  // 真进程：node <...>/packages/cli/src/main.ts <lobby|web-match> ...
  if (/^node(\d+)?$/.test(exe)) {
    if (!(argv[1] ?? "").endsWith("cli/src/main.ts")) return null;
    return isTarget(argv[2]) ? "node" : null;
  }

  // 包装层：pnpm exec poolhall <lobby|web-match> ...
  if (exe === "pnpm") {
    const i = argv.indexOf("poolhall");
    return i >= 0 && isTarget(argv[i + 1]) ? "wrapper" : null;
  }

  return null;
}

/** 读单个进程的 argv 与 ppid；读不到（已退出/无权限）返回 null */
function readProc(pid: number): Proc | null {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").filter(Boolean);
    if (argv.length === 0) return null;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    // stat 的 comm 字段可能含空格与括号，从最后一个 ')' 之后再取字段
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, ppid: Number(fields[1] ?? 0), argv };
  } catch {
    return null;
  }
}

/** 全部进程（按 pid 升序，保证输出稳定） */
function allProcs(): Proc[] {
  const out: Proc[] = [];
  for (const name of readdirSync("/proc").sort((a, b) => Number(a) - Number(b))) {
    if (!/^\d+$/.test(name)) continue;
    const p = readProc(Number(name));
    if (p) out.push(p);
  }
  return out;
}

/** 自身 + 全部祖先 pid（绝不能杀，否则脚本自杀、清理中断） */
function selfAndAncestors(procs: Proc[]): Set<number> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const keep = new Set<number>();
  let cur: number | undefined = process.pid;
  while (cur !== undefined && cur > 1 && !keep.has(cur)) {
    keep.add(cur);
    cur = byPid.get(cur)?.ppid;
  }
  return keep;
}

/** 待清理进程：node 本体排在包装层之前（反序会让真进程先变孤儿） */
export function findTargets(procs = allProcs()): Proc[] {
  const keep = selfAndAncestors(procs);
  return procs
    .filter((p) => !keep.has(p.pid) && classify(p.argv) !== null)
    .sort((a, b) => {
      const rank = (p: Proc): number => (classify(p.argv) === "node" ? 0 : 1);
      return rank(a) - rank(b) || a.pid - b.pid;
    });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const describe = (p: Proc): string => {
  const cmd = p.argv.join(" ");
  return cmd.length > 96 ? `${cmd.slice(0, 96)}…` : cmd;
};

async function main(): Promise<number> {
  const targets = findTargets();
  if (targets.length === 0) {
    console.log("无遗留的 lobby / web-match 进程");
    return 0;
  }

  console.log(`发现 ${targets.length} 个待清理进程：`);
  for (const t of targets) console.log(`  pid ${String(t.pid).padEnd(8)} ${describe(t)}`);

  for (const t of targets) {
    try {
      process.kill(t.pid, "SIGTERM");
    } catch {
      /* 已退出 */
    }
  }

  await sleep(2500);
  for (const t of targets.filter((x) => alive(x.pid))) {
    console.log(`  pid ${t.pid} 未响应 SIGTERM，SIGKILL`);
    try {
      process.kill(t.pid, "SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
  await sleep(500);

  const left = findTargets();
  if (left.length > 0) {
    console.error(`✗ 仍有 ${left.length} 个进程未清理：${left.map((p) => p.pid).join(", ")}`);
    return 1;
  }
  console.log(`✅ 已清理 ${targets.length} 个进程`);
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("scripts/stop.ts") ?? false;
if (invokedDirectly) {
  void main().then((code) => process.exit(code));
}
