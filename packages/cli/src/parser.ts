/** 从模型文本里宽容地抠出 JSON（取**最后一个**对象——允许推理后再给答案） */
export function parseShotJson(
  text: string,
): {
  angle?: number;
  power?: number;
  aimX?: number;
  aimY?: number;
  spin?: { x: number; y: number; z: number };
} | null {
  const matches = [...text.matchAll(/\{[^{}]*\}/gs)];
  if (matches.length === 0) return null;
  const m = matches[matches.length - 1]![0];
  try {
    const obj = JSON.parse(m) as {
      angle?: unknown;
      power?: unknown;
      aimX?: unknown;
      aimY?: unknown;
      spin?: unknown;
    };
    const power = Number(obj.power);
    const aimX = Number(obj.aimX);
    const aimY = Number(obj.aimY);
    const angle = Number(obj.angle);
    // spin 是 [x, y, z] 元组或 undefined（v7 新增；缺省全 0）
    let spin: { x: number; y: number; z: number } | undefined;
    if (Array.isArray(obj.spin) && obj.spin.length === 3) {
      const sx = Number(obj.spin[0]);
      const sy = Number(obj.spin[1]);
      const sz = Number(obj.spin[2]);
      if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
        const clip = (v: number) => Math.min(1, Math.max(-1, v));
        spin = { x: clip(sx), y: clip(sy), z: clip(sz) };
      }
    }
    // 优先 aimAt 点坐标（v6 接口）；fallback 到 angle（兼容）
    if (Number.isFinite(aimX) && Number.isFinite(aimY) && Number.isFinite(power)) {
      return { aimX, aimY, power: Math.min(1, Math.max(0, power)), spin };
    }
    if (Number.isFinite(angle) && Number.isFinite(power)) {
      return { angle, power: Math.min(1, Math.max(0, power)), spin };
    }
    return null;
  } catch {
    return null;
  }
}
