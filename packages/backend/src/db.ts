import Database from "better-sqlite3";
import path from "node:path";
import { ethers } from "ethers";
import type { BackendState } from "./contracts.js";

/**
 * SQLite persistence layer. Caches capabilities and completions so the
 * backend doesn't re-register Agent A's capability on restart and doesn't
 * re-scan the chain on every /api/discover call.
 */
let _db: Database.Database | null = null;

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "taop.db");

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS capabilities (
      capability_id INTEGER PRIMARY KEY,
      creator TEXT NOT NULL,
      bond TEXT NOT NULL,
      capability_type TEXT NOT NULL,
      metadata_cid TEXT NOT NULL,
      certified INTEGER NOT NULL DEFAULT 0,
      slashed INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completions (
      completion_id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      task_type TEXT NOT NULL,
      result_cid TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      challenged INTEGER NOT NULL DEFAULT 0,
      disputed INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return _db;
}

export function getMeta(key: string): string | null {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

export function isCapabilityRegistered(creator: string, capabilityType: string): bigint | null {
  const row = db()
    .prepare("SELECT capability_id FROM capabilities WHERE creator = ? AND capability_type = ?")
    .get(creator.toLowerCase(), capabilityType.toLowerCase()) as { capability_id: number } | undefined;
  return row ? BigInt(row.capability_id) : null;
}

export function recordCapability(c: {
  capabilityId: bigint;
  creator: string;
  bond: bigint;
  capabilityType: string;
  metadataCID: string;
  certified: boolean;
}): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO capabilities
       (capability_id, creator, bond, capability_type, metadata_cid, certified, slashed, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      Number(c.capabilityId),
      c.creator.toLowerCase(),
      c.bond.toString(),
      c.capabilityType.toLowerCase(),
      c.metadataCID,
      c.certified ? 1 : 0,
      new Date().toISOString(),
    );
}

export function recordCompletion(c: {
  completionId: bigint;
  agent: string;
  taskType: string;
  resultCID: string;
  timestamp: bigint;
  txHash: string | null;
}): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO completions
       (completion_id, agent, task_type, result_cid, timestamp, challenged, disputed, tx_hash, recorded_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(
      Number(c.completionId),
      c.agent.toLowerCase(),
      c.taskType.toLowerCase(),
      c.resultCID,
      Number(c.timestamp),
      c.txHash,
      new Date().toISOString(),
    );
}

export function listCapabilities(): Array<{
  capabilityId: string;
  creator: string;
  bond: string;
  capabilityType: string;
  metadataCID: string;
  certified: boolean;
  slashed: boolean;
}> {
  const rows = db().prepare("SELECT * FROM capabilities ORDER BY capability_id").all() as Array<{
    capability_id: number;
    creator: string;
    bond: string;
    capability_type: string;
    metadata_cid: string;
    certified: number;
    slashed: number;
  }>;
  return rows.map((r) => ({
    capabilityId: String(r.capability_id),
    creator: r.creator,
    bond: ethers.formatEther(BigInt(r.bond)),
    capabilityType: r.capability_type,
    metadataCID: r.metadata_cid,
    certified: r.certified === 1,
    slashed: r.slashed === 1,
  }));
}

export function listCompletions(): Array<{
  completionId: string;
  agent: string;
  taskType: string;
  resultCID: string;
  timestamp: string;
  challenged: boolean;
  disputed: boolean;
  txHash: string | null;
}> {
  const rows = db().prepare("SELECT * FROM completions ORDER BY completion_id DESC LIMIT 50").all() as Array<{
    completion_id: number;
    agent: string;
    task_type: string;
    result_cid: string;
    timestamp: number;
    challenged: number;
    disputed: number;
    tx_hash: string | null;
  }>;
  return rows.map((r) => ({
    completionId: String(r.completion_id),
    agent: r.agent,
    taskType: r.task_type,
    resultCID: r.result_cid,
    timestamp: String(r.timestamp),
    challenged: r.challenged === 1,
    disputed: r.disputed === 1,
    txHash: r.tx_hash,
  }));
}

/** Refresh the on-chain score for an agent and return completions/disputes/score. */
export async function refreshScore(
  state: BackendState,
  agent: string,
): Promise<{ completions: bigint; disputes: bigint; score: bigint }> {
  const s = await state.ron.getSelfAttestScore(agent);
  return { completions: s.completions, disputes: s.disputes, score: s.score };
}