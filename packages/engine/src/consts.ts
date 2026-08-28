/**
 * 物理常数表（docs/physics.md §2）
 * 默认值溯源 pooltool-billiards 0.6.0（ball/params.py、table/collection.py），
 * 上游为 Dr. Dave（billiards.colostate.edu）物理参数页。
 */

/** 球物理参数（v0：spin 相关量仅记录，ω_z 冻结；v1 解冻 u_sp；v2 解冻 throw） */
export interface BallParams {
  /** 质量 kg */
  m: number;
  /** 半径 m */
  R: number;
  /** 滑动摩擦系数 */
  u_s: number;
  /** 滚动阻力系数 */
  u_r: number;
  /** 自转衰减系数（v1 解冻，pooltool u_sp_proportionality = 10·2/5/9 ≈ 0.444·R） */
  u_sp: number;
  /** 球-球恢复系数 */
  e_b: number;
  /** 球-库边恢复系数 */
  e_c: number;
  /** 库边切向保留系数（f_c=0.2 的简化折算） */
  tangentKeep: number;
  /** 球-球 spin→vel 切向转化系数（v2 throw；0=v0 行为；参考 pooltool Mathavan 简化） */
  throwSigma: number;
  /** 库边 spin→vel 切向转化系数（v2 加塞） */
  cushionSpinSigma: number;
  /** 重力 m/s² */
  g: number;
}

export const DEFAULT_BALL: BallParams = {
  m: 0.170097,
  R: 0.028575,
  u_s: 0.2,
  u_r: 0.01,
  u_sp: 0.0127, // v1: spinning 状态机启用
  e_b: 0.95,
  e_c: 0.85,
  tangentKeep: 0.9,
  throwSigma: 0.05, // v2: 球-球 spin→vel 切向（实验值，待 golden 校准）
  cushionSpinSigma: 0.08, // v2: 库边 spin→vel 切向（加塞，实验值）
  g: 9.81,
};

/**
 * spin 输入缩放：API 输入 spin ∈ [-1, 1] 映射到 ω 角速度 rad/s。
 * 30 rad/s ≈ 5 rev/s，是人类能施加的最大 spin 估算值。
 * v1 校准值，golden 对拍在 v0 spin=0 场景不受影响。
 */
export const SPIN_SCALE = 30 as const;

/** 台面规格（胶边内沿尺寸 + 袋口宽，v0 袋口为圆判定区） */
export interface TableSpecs {
  width: number;
  height: number;
  /** 角袋口宽 m（判定圆半径 = 口宽/2，圆心在台角） */
  cornerMouth: number;
  /** 中袋口宽 m（判定圆半径 = 口宽/2，圆心在长边中点） */
  sideMouth: number;
}

/** 美式 7 尺台（pooltool SEVEN_FOOT_SHOWOOD 实测值） */
export const SEVEN_FOOT: TableSpecs = {
  width: 1.9812,
  height: 0.9906,
  cornerMouth: 0.11811,
  sideMouth: 0.136525,
};

/** 模拟与阈值参数 */
export const SIM = {
  /** 固定积分步长 1ms（A' 方案，docs/physics.md §5） */
  dt: 0.001,
  /** 轨迹采样间隔（渲染/哈希原料） */
  sampleEvery: 0.01,
  /** 停球速度阈值 m/s */
  stopV: 0.01,
  /** 停球角速度阈值 rad/s */
  stopW: 0.1,
  /** 滑动→滚动切换阈值（接触点相对速度 m/s） */
  uStop: 0.01,
  /** 自转存活阈值 rad/s（v1 spinning 分支判停） */
  spinStop: 0.1,
  /** 模拟 watchdog（模拟时间秒），防死循环 */
  watchdog: 120,
  /** 单步内最大碰撞解算次数（挤夹死循环保护） */
  maxEventsPerStep: 64,
} as const;

/** 出杆力度 → 球速映射（docs/physics.md §2：[0,1] 线性映射 0.5–8 m/s） */
export const POWER = {
  min: 0.5,
  max: 8,
} as const;

export const speedOf = (power: number): number => POWER.min + (POWER.max - POWER.min) * power;
