/**
 * 2D 向量纯函数库（零依赖手写，docs/tech-stack.md）
 * 不可变风格：所有运算返回新对象，利于确定性。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;

export const len = (a: Vec2): number => Math.sqrt(len2(a));

export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));

/** 单位向量；零向量返回 (0,0)（约定，避免 NaN） */
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

export const EPS = 1e-9;
