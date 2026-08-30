/**
 * 持久化（docs/hand-model.md §3 跨局肌肉记忆 + 战绩）
 * node:sqlite（Node 内置，零原生编译）；路径 ':memory:' 用于测试。
 */
import { DatabaseSync } from "node:sqlite";

export interface ShotRow {
  sessionId: number;
  trial: number;
  intentAngle: number;
  intentPower: number;
  actualAngle: number;
  actualPower: number;
  optimal: number | null;
  pot: boolean;
}

export interface AgentStats {
  sessions: number;
  shots: number;
  pots: number;
}

/** Elo 参数：初始分 1500，K=32（标准起步系数） */
export const ELO_INITIAL = 1500;
export const ELO_K = 32;

/** 单局增减分：score = 1 胜 / 0.5 平 / 0 负；双方增减互为相反数（同分对局零和） */
export function eloDelta(ratingA: number, ratingB: number, score: 0 | 0.5 | 1): number {
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return ELO_K * (score - expected);
}

export interface EloEntry {
  name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
}

export interface MatchRecordResult {
  ratingA: number;
  ratingB: number;
  deltaA: number;
  deltaB: number;
}

export class Store {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        seed INTEGER NOT NULL,
        started_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        trial INTEGER NOT NULL,
        intent_angle REAL NOT NULL,
        intent_power REAL NOT NULL,
        actual_angle REAL NOT NULL,
        actual_power REAL NOT NULL,
        optimal REAL,
        pot INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hand_state (
        agent TEXT PRIMARY KEY,
        bias REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elo (
        name TEXT PRIMARY KEY,
        rating REAL NOT NULL,
        wins INTEGER NOT NULL,
        losses INTEGER NOT NULL,
        draws INTEGER NOT NULL,
        games INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elo_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_a TEXT NOT NULL,
        name_b TEXT NOT NULL,
        winner TEXT,
        reason TEXT,
        delta_a REAL NOT NULL,
        delta_b REAL NOT NULL,
        played_at INTEGER NOT NULL
      );
    `);
  }

  ensureAgent(name: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO agents (name, created_at) VALUES (?, ?)")
      .run(name, Date.now());
  }

  startSession(agent: string, mode: string, seed: number): number {
    this.ensureAgent(agent);
    const r = this.db
      .prepare("INSERT INTO sessions (agent, mode, seed, started_at) VALUES (?, ?, ?, ?)")
      .run(agent, mode, seed, Date.now());
    return Number(r.lastInsertRowid);
  }

  recordShot(row: ShotRow): void {
    this.db
      .prepare(
        `INSERT INTO shots (session_id, trial, intent_angle, intent_power,
         actual_angle, actual_power, optimal, pot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.sessionId,
        row.trial,
        row.intentAngle,
        row.intentPower,
        row.actualAngle,
        row.actualPower,
        row.optimal,
        row.pot ? 1 : 0,
      );
  }

  /** 读上次保存的 bias（跨局肌肉记忆）；无则返回 null（由身份种子新生成） */
  loadBias(agent: string): number | null {
    const row = this.db.prepare("SELECT bias FROM hand_state WHERE agent = ?").get(agent);
    return row ? Number((row as { bias: number }).bias) : null;
  }

  saveBias(agent: string, bias: number): void {
    this.ensureAgent(agent);
    this.db
      .prepare(
        `INSERT INTO hand_state (agent, bias, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(agent) DO UPDATE SET bias = excluded.bias, updated_at = excluded.updated_at`,
      )
      .run(agent, bias, Date.now());
  }

  stats(agent: string): AgentStats {
    const sessions = this.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE agent = ?")
      .get(agent) as { n: number };
    const agg = this.db
      .prepare(
        "SELECT COUNT(*) AS n, SUM(pot) AS p FROM shots WHERE session_id IN (SELECT id FROM sessions WHERE agent = ?)",
      )
      .get(agent) as { n: number; p: number | null };
    return {
      sessions: Number(sessions.n),
      shots: Number(agg.n),
      pots: Number(agg.p ?? 0),
    };
  }

  private eloRating(name: string): number {
    const row = this.db.prepare("SELECT rating FROM elo WHERE name = ?").get(name) as
      | { rating: number }
      | undefined;
    return row ? Number(row.rating) : ELO_INITIAL;
  }

  private upsertElo(name: string, rating: number, field: "wins" | "losses" | "draws"): void {
    this.db
      .prepare(
        `INSERT INTO elo (name, rating, wins, losses, draws, games, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(name) DO UPDATE SET
           rating = excluded.rating,
           ${field} = ${field} + 1,
           games = games + 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        name,
        rating,
        field === "wins" ? 1 : 0,
        field === "losses" ? 1 : 0,
        field === "draws" ? 1 : 0,
        Date.now(),
      );
  }

  /** 对局结果入账：返回双方新分与增减（胜/负/平局均计入榜单） */
  recordMatchResult(
    nameA: string,
    nameB: string,
    winner: "A" | "B" | null,
    reason: string | null = null,
  ): MatchRecordResult {
    const ratingA = this.eloRating(nameA);
    const ratingB = this.eloRating(nameB);
    const scoreA: 0 | 0.5 | 1 = winner === "A" ? 1 : winner === "B" ? 0 : 0.5;
    const deltaA = eloDelta(ratingA, ratingB, scoreA);
    const newA = ratingA + deltaA;
    const newB = ratingB - deltaA;
    this.upsertElo(nameA, newA, winner === "A" ? "wins" : winner === "B" ? "losses" : "draws");
    this.upsertElo(nameB, newB, winner === "B" ? "wins" : winner === "A" ? "losses" : "draws");
    this.db
      .prepare(
        `INSERT INTO elo_matches (name_a, name_b, winner, reason, delta_a, delta_b, played_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(nameA, nameB, winner, reason, deltaA, -deltaA, Date.now());
    return { ratingA: newA, ratingB: newB, deltaA, deltaB: -deltaA };
  }

  /** 榜单：按分高到低（同分按胜场） */
  leaderboard(limit = 20): EloEntry[] {
    const rows = this.db
      .prepare(
        `SELECT name, rating, wins, losses, draws, games FROM elo
         ORDER BY rating DESC, wins DESC, name ASC LIMIT ?`,
      )
      .all(limit) as Array<{
      name: string;
      rating: number;
      wins: number;
      losses: number;
      draws: number;
      games: number;
    }>;
    return rows.map((row) => ({
      name: row.name,
      rating: Number(row.rating.toFixed(1)),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
      games: Number(row.games),
    }));
  }

  close(): void {
    this.db.close();
  }
}
