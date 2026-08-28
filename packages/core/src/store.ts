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

  close(): void {
    this.db.close();
  }
}
