#!/usr/bin/env python
"""知行曲线出图（docs/benchmark.md §7）

输入：research JSONL（--agent 输出的日志），其一杆一行：
  {"kind":"shot", "trial":k, "optimal":θ*, "intentAngle":θ, "actualAngle":θ', "pot":bool}

曲线定义（docs/hand-model.md §4）：
  - 结果误差 e_k = actual − optimal（角度域，环绕归一）
  - 知行曲线：|e_k| 的滑动均值（窗口 5）随杆数 k
  - 补偿曲线：c_k = intent − optimal（agent 是否在"瞄歪补偿"）

用法：uv run python plot.py results/*.jsonl -o figs/
"""
import argparse
import glob
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

WINDOW = 5


def ang_norm(d: float) -> float:
    """角度环绕归一到 (−180, 180]"""
    return (d + 180.0) % 360.0 - 180.0


def load_cases(path: str) -> list[dict]:
    rows = [json.loads(l) for l in open(path)]
    shots = [r for r in rows if r.get("kind") == "shot"]
    agent = next((r["agent"] for r in rows if r.get("kind") == "meta"), "?")
    seed = next((r["seed"] for r in rows if r.get("kind") == "meta"), -1)
    return [{"shots": shots, "agent": agent, "seed": seed, "file": path}]


def rolling(xs: list[float], w: int) -> list[float]:
    return [sum(xs[max(0, i - w + 1) : i + 1]) / len(xs[max(0, i - w + 1) : i + 1]) for i in range(len(xs))]


def curve(case: dict) -> tuple[list[int], list[float], list[float]]:
    ks, e, c = [], [], []
    for s in case["shots"]:
        if s["optimal"] is None:
            continue
        ks.append(s["trial"])
        e.append(abs(ang_norm(s["actualAngle"] - s["optimal"])))
        c.append(ang_norm(s["intentAngle"] - s["optimal"]))
    return ks, rolling_abs(e), c


def rolling_abs(e: list[float]) -> list[float]:
    return rolling([abs(x) for x in e])


def rolling(xs: list[float]) -> list[float]:
    out = []
    for i in range(len(xs)):
        w = xs[max(0, i - WINDOW + 1) : i + 1]
        out.append(sum(w) / len(w))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", nargs="+", help="research JSONL 路径或 glob")
    ap.add_argument("-o", "--out", default="experiments/figs")
    args = ap.parse_args()

    paths: list[str] = []
    for pat in args.logs:
        paths.extend(sorted(glob.glob(pat)))
    if not paths:
        raise SystemExit("无输入日志")

    cases = [c for p in paths for c in load_cases(p)]
    Path(args.out).mkdir(parents=True, exist_ok=True)

    # ── 图 1：知行曲线（|结果误差| 滑动均值 vs 杆数，逐 agent 分色） ──
    fig, ax = plt.subplots(figsize=(9, 5.5))
    for c in cases:
        ks, e_roll, _ = curve(c)
        label = f"{c['agent']} (s{c['seed']})"
        ax.plot(ks, e_roll, marker="o", ms=3, label=label)
    ax.set_xlabel("杆数（trial）")
    ax.set_ylabel("结果角误差 滑动均值（°，窗 5）")
    ax.set_title("知行曲线 · PoolHall 校准挑战")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    p1 = Path(args.out) / "zhixing.png"
    fig.savefig(p1, dpi=140)
    print(f"✓ {p1}")

    # ── 图 2：补偿曲线（c_k = intent − optimal，单位度） ──
    fig, ax = plt.subplots(figsize=(9, 5.5))
    for c in cases:
        ks, _, comp = curve(c)
        ax.plot(ks, comp, marker="o", ms=3, label=f"{c['agent']} (s{c['seed']})")
    ax.axhline(0, color="k", lw=0.8)
    ax.set_xlabel("杆数（trial）")
    ax.set_ylabel("补偿量 c = intent − optimal（°）")
    ax.set_title("补偿曲线 · agent 是否主动右修/左修")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    p2 = Path(args.out) / "compensation.png"
    fig.savefig(p2, dpi=140)
    print(f"✓ {p2}")

    # ── 终值摘要 ──
    for c in cases:
        ks, e_roll, _ = curve(c)
        n = len(c["shots"])
        pots = sum(1 for s in c["shots"] if s["pot"])
        med_last = e_roll[-1] if e_roll else float("nan")
        print(f"{c['agent']:18s} seed={c['seed']:<4d} {pots:>2}/{n}  末窗|e|={med_last:6.2f}°")


if __name__ == "__main__":
    main()
