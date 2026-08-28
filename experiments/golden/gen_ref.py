#!/usr/bin/env python
"""golden 对拍：pooltool 0.6.0 参考轨迹（docs/physics.md §7）

与 scripts/golden.ts 的五场景一一对应。

坐标变换（poolhall → pooltool）：
  poolhall：原点左上，x 向右（长边），y 向下；angle 度，0=+x，屏幕逆时针为正
  pooltool：原点左下，y 向上（长边沿 y）；phi 数学角
  映射：pt_x = ph_y, pt_y = ph_x, pt_z = R；phi = 90 + angle

物理模型对齐（v0 能力域，docs/physics.md）：
  球-球：FrictionlessElastic（等质量弹性、无 throw）——poolhall v0 同
  库边：Han2005Linear（法向 e_c + 切向摩擦）——poolhall v0 用简化切向保留，存在小差异
  台面：seven_foot（pooltool Eight Ball 默认）

用法：uv run python gen_ref.py [--model stronge]
（pooltool 本体安装见 README.md）
"""

import json
import math
from pathlib import Path

import pooltool as pt
import pooltool.evolution as ev
from pooltool.objects.ball.datatypes import Ball
from pooltool.physics.engine import PhysicsEngine
from pooltool.physics.resolve.ball_ball.frictionless_elastic import FrictionlessElastic
from pooltool.physics.resolve.ball_cushion.han_2005 import Han2005Linear, Han2005Circular
from pooltool.physics.resolve.resolver import Resolver
from pooltool.system.datatypes import System

PH_W = 1.9812  # poolhall 台宽（x，长边）
PH_H = 0.9906  # poolhall 台高（y）

SCENES = [
    {"name": "straight", "cue": [0.5, 0.5], "balls": {"1": [1.2, 0.5]}, "angle": 0.0, "power": 0.5},
    {"name": "cut", "cue": [0.6, 0.5], "balls": {"1": [1.3, 0.4]}, "angle": 6.5, "power": 0.5},
    {"name": "cushion", "cue": [0.5, 0.3], "balls": {}, "angle": 90.0, "power": 0.4},
    {"name": "pot", "cue": [1.7, 0.75], "balls": {}, "angle": 23.78, "power": 0.5},
    {"name": "combo", "cue": [0.4, 0.5], "balls": {"1": [0.9, 0.5], "2": [1.4, 0.5]}, "angle": 0.0, "power": 0.7},
]

POWER_MIN, POWER_MAX = 0.5, 8.0

# pooltool V0 是杆速，经 InstantaneousPoint 模型放大为球速：
#   v_ball = V0 × 2M/(M+m)（M=0.567 杆质量，m=0.170097 球质量，实测倍率 1.538）
# 反解：V0 = target_speed × (M+m) / (2M)
CUE_M = 0.567
BALL_M = 0.170097
V0_FACTOR = (CUE_M + BALL_M) / (2 * CUE_M)


def speed_of(power: float) -> float:
    """power → 目标球速（与 poolhall speedOf 一致）"""
    return POWER_MIN + (POWER_MAX - POWER_MIN) * power


def to_pt(ph_xy: tuple[float, float]) -> tuple[float, float]:
    """poolhall (x,y) → pooltool (x',y')：转置"""
    return ph_xy[1], ph_xy[0]


def to_ph(pt_xy: tuple[float, float]) -> tuple[float, float]:
    return pt_xy[1], pt_xy[0]


def make_engine() -> PhysicsEngine:
    # 从默认 resolver 起步，只替换球-球与库边模型（袋口/出杆/状态转移用默认）
    base = Resolver.default()
    resolver = Resolver(
        ball_ball=FrictionlessElastic(),
        ball_linear_cushion=Han2005Linear(),
        ball_circular_cushion=Han2005Circular(),
        ball_pocket=base.ball_pocket,
        stick_ball=base.stick_ball,
        transition=base.transition,
    )
    return PhysicsEngine(resolver=resolver)


def build_scene(sc: dict) -> System:
    table = pt.Table.from_game_type("Eight Ball")
    balls = {"cue": Ball.create("cue", xy=to_pt((sc["cue"][0], sc["cue"][1])))}
    for bid, xy in sc["balls"].items():
        balls[bid] = Ball.create(bid, xy=to_pt((xy[0], xy[1])))
    speed = speed_of(sc["power"]) * V0_FACTOR
    cue = pt.Cue(cue_ball_id="cue")
    cue.set_state(V0=speed, phi=90 + sc["angle"], a=0, b=0, theta=0)
    return System(table=table, balls=balls, cue=cue)


def main() -> None:
    engine = make_engine()
    out = []
    for sc in SCENES:
        sys = build_scene(sc)
        ev.simulate(sys, engine=engine, inplace=True, continuous=False)

        finals = {}
        for bid, b in sys.balls.items():
            x, y = to_ph((float(b.state.rvw[0][0]), float(b.state.rvw[0][1])))
            finals[bid] = [round(x, 6), round(y, 6)]

        events = []
        for e in sys.events:
            et = e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type)
            if et in ("none", "stick_ball"):
                continue
            events.append({
                "t": round(e.time, 6),
                "kind": et,
                "agents": [a.id for a in e.agents],
            })

        out.append({"name": sc["name"], "finals": finals, "events": events})
        print(f"{sc['name']}: {len(events)} events, t={sys.t:.3f}s, finals={ {k: [round(v,3) for v in xy] for k, xy in finals.items()} }")

    ref = Path(__file__).parent / "pooltool_ref.json"
    ref.write_text(json.dumps({"cases": out}, indent=2) + "\n")
    print(f"\n✓ 写入 {ref}")


if __name__ == "__main__":
    main()
