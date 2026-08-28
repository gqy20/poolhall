/**
 * 确定性红线扫描（AGENTS.md §2.4 / docs/tech-stack.md §5）
 *
 * 扫描 packages/engine/src 的运行时代码：
 *   - 禁随机源 / 时钟 / 环境变量 / I-O / CJS require
 *   - 禁第三方依赖 import（engine 运行时依赖必须为空）
 *   - packages/engine/package.json 的 dependencies 必须为空
 *
 * 测试文件豁免（*.test.ts 与 __tests__/ 目录）：测试工具链不算运行时依赖。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["随机源 Math.random", /\bMath\.random\b/],
  ["时钟 Date.now / new Date", /\bDate\.now\b|\bnew\s+Date\s*\(/],
  ["时钟 performance.now", /\bperformance\.now\b/],
  ["计时器 setTimeout / setInterval", /\b(setTimeout|setInterval)\b/],
  ["环境变量 process.env", /\bprocess\.env\b/],
  ["网络 fetch", /\bfetch\s*\(/],
  ["文件系统 node:fs", /["']node:fs/],
  [
    "进程/网络等其他 node 内置",
    /["']node:(net|http|https|os|child_process|worker_threads|dns|tls|dgram|repl|v8)["']/,
  ],
  ["CommonJS require", /(^|[^\w.])require\s*\(/],
];

/** 匹配 from "x" / import "x" / import("x") 的模块说明符 */
const SPECIFIER_RE = /(?:\bfrom\s*|^\s*import\s*|import\s*\(\s*)["']([^"']+)["']/g;

const isCommentLine = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);

const isAllowedSpecifier = (spec: string): boolean =>
  spec.startsWith(".") || spec.startsWith("node:") || spec.startsWith("#");

/** 扫描单段源码文本（按行），返回全部违规 */
export function scanText(text: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const [rule, re] of FORBIDDEN) {
      if (re.test(line)) {
        violations.push({ file, line: i + 1, rule, text: line.trim() });
      }
    }
    if (isCommentLine(line)) continue;
    for (const m of line.matchAll(SPECIFIER_RE)) {
      const spec = m[1] ?? "";
      if (!isAllowedSpecifier(spec)) {
        violations.push({
          file,
          line: i + 1,
          rule: `第三方依赖 import "${spec}"`,
          text: line.trim(),
        });
      }
    }
  }
  return violations;
}

/** 递归扫描目录（跳过测试与构建产物），返回违规与文件计数 */
export function scanDir(dir: string): { violations: Violation[]; scanned: number } {
  const violations: Violation[] = [];
  let scanned = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules" || name === "dist") continue;
        walk(full);
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        scanned += 1;
        violations.push(...scanText(readFileSync(full, "utf-8"), full));
      }
    }
  };
  walk(dir);
  return { violations, scanned };
}

/** engine 的 package.json dependencies 必须为空 */
export function checkEngineDeps(
  pkg: { dependencies?: Record<string, string> },
  file = "packages/engine/package.json",
): Violation[] {
  return Object.keys(pkg.dependencies ?? {}).map((name) => ({
    file,
    line: 0,
    rule: `运行时依赖违规 "${name}"`,
    text: `dependencies.${name}`,
  }));
}

function main(): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const engineSrc = join(root, "packages", "engine", "src");
  const enginePkg = join(root, "packages", "engine", "package.json");

  const violations: Violation[] = [];
  let scanned = 0;
  if (statSync(engineSrc).isDirectory()) {
    const r = scanDir(engineSrc);
    violations.push(...r.violations);
    scanned = r.scanned;
  }
  violations.push(...checkEngineDeps(JSON.parse(readFileSync(enginePkg, "utf-8"))));

  if (violations.length > 0) {
    console.error(`✗ 确定性红线被打破（engine 包，${violations.length} 处）：`);
    for (const v of violations) {
      const loc = v.line > 0 ? `${relative(root, v.file)}:${v.line}` : relative(root, v.file);
      console.error(`  ${loc}  [${v.rule}]`);
      console.error(`    ${v.text}`);
    }
    console.error("规范见 AGENTS.md §2.4。修复前禁止合入。");
    return 1;
  }
  console.log(`✓ 红线扫描通过：engine ${scanned} 个源文件、依赖表干净`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main());
}
