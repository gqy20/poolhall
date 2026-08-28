/**
 * 演示场景库（CLI demo/trace 与 golden 生成共用）
 */
import { type Ball, makeBall, strike, vec2 } from "@poolhall/engine";

export interface DemoScene {
  name: string;
  desc: string;
  setup: () => Ball[];
}

/** 基础五场景（golden 对拍 v0 场景域，docs/physics.md §7） */
export const demoScenes: DemoScene[] = [
  {
    name: "straight",
    desc: "直线球：母球沿中线直击 1 号球进右中袋方向",
    setup: () => {
      const cue = makeBall("cue", vec2(0.5, 0.5));
      const one = makeBall("1", vec2(1.2, 0.5));
      strike(cue, 0, 0.5);
      return [cue, one];
    },
  },
  {
    name: "cut",
    desc: "切角球：30° 切角打 1 号球进右上角袋",
    setup: () => {
      const cue = makeBall("cue", vec2(0.6, 0.5));
      const one = makeBall("1", vec2(1.3, 0.4));
      strike(cue, 6.5, 0.5);
      return [cue, one];
    },
  },
  {
    name: "cushion",
    desc: "吃库：母球垂直撞上库反弹",
    setup: () => {
      const cue = makeBall("cue", vec2(0.5, 0.3));
      strike(cue, 90, 0.4);
      return [cue];
    },
  },
  {
    name: "pot",
    desc: "直线进袋：母球直接打进左上角袋",
    setup: () => {
      const cue = makeBall("cue", vec2(1.7, 0.75));
      strike(cue, (Math.atan2(0.75, 1.7) * 180) / Math.PI, 0.5);
      return [cue];
    },
  },
  {
    name: "combo",
    desc: "三球组合：母球 → 1 → 2 传递",
    setup: () => {
      const cue = makeBall("cue", vec2(0.4, 0.5));
      const one = makeBall("1", vec2(0.9, 0.5));
      const two = makeBall("2", vec2(1.4, 0.5));
      strike(cue, 0, 0.7);
      return [cue, one, two];
    },
  },
];
