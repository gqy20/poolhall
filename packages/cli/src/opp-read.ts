/**
 * 读对手证据链（心理层 v1）：从"意图角 vs 母球实际出射角"估计对手系统性偏差
 *
 * 原理：注入层 actual = intent + bias + ε（hand.ts）。intentAngle 与母球初始出射角
 * （cueHeading）都是可观测量，二者逐杆之差 = bias + ε，ε 为零均值随机噪声（σ≤0.08°）。
 * 多杆归纳一致性即得对手的系统性偏差——读的是公开事实，不碰隐藏态。
 *
 * 曾尝试"目标球出射方向相对袋口线偏转 + 杠杆还原"路线，实测被模型执行噪声（30°+）
 * 与伪意图袋口淹没（docs/match.md §7），已弃用。
 */

export interface ShotFactLike {
  shot: number;
  by: string;
  intentAngle?: number | null;
  /** 母球初始出射角（度，出杆角约定） */
  cueHeading?: number | null;
}

export interface OppShotEvidence {
  shot: number;
  intentAngle: number;
  cueHeading: number;
  /** 本杆注入测量 = cueHeading − intentAngle（= bias + ε） */
  biasEstDeg: number;
}

function norm180(deg: number): number {
  let d = deg;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** 每局一个：按杆序喂公开事实，产出对手偏差测量行 */
export class OppTracker {
  /** 要读的对象（只收集该座出杆的测量；缺省全收） */
  opponent: string | null = null;
  private lastShot = -1;
  readonly rows: OppShotEvidence[] = [];

  /** 新局检测：杆号回退即重置（大厅自动续局） */
  private maybeReset(shot: number): void {
    if (shot > this.lastShot) return;
    this.rows.length = 0;
    this.lastShot = -1;
  }

  /** 按杆序喂一条公开出杆事实（只需 intentAngle + cueHeading） */
  ingest(fact: ShotFactLike): void {
    this.maybeReset(fact.shot);
    this.lastShot = fact.shot;
    const usable =
      Number.isFinite(fact.intentAngle) &&
      Number.isFinite(fact.cueHeading) &&
      (this.opponent === null || fact.by === this.opponent);
    if (!usable) return;
    const intent = fact.intentAngle as number;
    const heading = fact.cueHeading as number;
    const est = norm180(heading - intent);
    // 物理上限：|bias|≤0.2°、|ε|≲0.3°，超过 1° 必为测量污染（贴球碰撞/重置帧）——丢弃，
    // 否则单个离群值会拖坏聚合（实测每局 1-2 个 −10°〜−27° 污染点）
    if (Math.abs(est) > 1) return;
    this.rows.push({
      shot: fact.shot,
      intentAngle: Number(intent.toFixed(1)),
      cueHeading: Number(heading.toFixed(1)),
      biasEstDeg: Number(est.toFixed(3)),
    });
  }

  /** 可用测量行数 */
  usable(): number {
    return this.rows.length;
  }

  /** 渲染给模型的证据文本（约定与噪声性质一并给出；不给现成均值，考的是归纳） */
  render(): string {
    const lines = this.rows.map(
      (r) =>
        `第${r.shot}杆：意图角 ${r.intentAngle}°，母球实际出射 ${r.cueHeading}°，差值 ${r.biasEstDeg}°`,
    );
    return (
      `<opponent_shot_evidence>\n` +
      `角度约定：出杆角 = atan2(-Δy, Δx)（y 向下为正）；正值 = 偏向台面 y 减小一侧（上方）。\n` +
      `物理事实：母球实际出射 = 意图角 + 系统性偏差 + 单杆随机噪声；随机噪声零均值（σ≤0.08°），\n` +
      `系统性偏差在多杆间保持同号同量级——从下列逐杆差值中归纳它。\n` +
      `${lines.join("\n")}\n` +
      `</opponent_shot_evidence>`
    );
  }
}
