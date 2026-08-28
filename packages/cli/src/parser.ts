/** 从模型文本里宽容地抠出 JSON 出杆对象（parse 失败返回 null，上层纠偏） */
export function parseShotJson(text: string): { angle: number; power: number } | null {
  const m = text.match(/\{[^{}]*\}/s);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { angle?: unknown; power?: unknown };
    const angle = Number(obj.angle);
    const power = Number(obj.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return null;
    return { angle, power: Math.min(1, Math.max(0, power)) };
  } catch {
    return null;
  }
}
