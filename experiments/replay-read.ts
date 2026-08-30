// 离线重放：真实事件日志 → (intentAngle, cueHeading) → OppTracker，验证读人证据质量
// 用法: node experiments/replay-read.ts <事件日志> <对手座 A|B>
import { readFileSync } from "node:fs";
import { OppTracker } from "../packages/cli/src/opp-read.ts";
import { expandMatchSamples } from "../packages/core/src/index.ts";

const file = process.argv[2] ?? "experiments/results/eval-reading2/t1-g0.jsonl";
const opp = process.argv[3] ?? "A";
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => JSON.parse(l));
const tracker = new OppTracker();
tracker.opponent = opp;
for (const e of events) {
  if (e.type !== "shot") continue;
  tracker.ingest({ shot: e.trial, by: e.by, intentAngle: e.intentAngle, cueHeading: e.cueHeading });
}
console.log(`对手 ${opp} 测量行数:`, tracker.usable());
const vals = tracker.rows.map((r) => r.biasEstDeg);
console.log("逐杆测量:", vals.join(", "));
const sorted = [...vals].sort((a, b) => a - b);
const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
if (trimmed.length)
  console.log("裁剪均值:", (trimmed.reduce((a, b) => a + b, 0) / trimmed.length).toFixed(4));
