import { ethers } from "ethers";
import { db } from "./db.js";

/**
 * F10 — persistence for the off-chain log indexer.
 *
 * The indexer polls `eth_getLogs` for the two TAOP contracts and denormalises
 * just enough state to serve paginated discovery without an O(n) RPC fan-out:
 *   - `capabilities` (shared with db.ts) for the registry
 *   - `agent_scores` / `completion_receipts` for the two-sided score components
 *   - `agent_identity` for profile metadata CIDs
 *   - `indexed_logs` for idempotency (a re-poll never double-counts)
 */

export function initIndexSchema(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS agent_scores (
      agent TEXT PRIMARY KEY,
      completions INTEGER NOT NULL DEFAULT 0,
      confirmed INTEGER NOT NULL DEFAULT 0,
      disputes INTEGER NOT NULL DEFAULT 0,
      last_activity INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS completion_receipts (
      completion_id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      receipt_ts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS agent_identity (
      agent TEXT PRIMARY KEY,
      metadata_cid TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS indexed_logs (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// --- alerts (F12) ---

export function recordAlert(kind: string, blockNumber: number, txHash: string, payload: unknown): void {
  db()
    .prepare(
      "INSERT INTO alerts (kind, block_number, tx_hash, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(kind, blockNumber, txHash, JSON.stringify(payload ?? {}), new Date().toISOString());
}

export function listAlerts(limit = 50): Array<{
  id: number;
  kind: string;
  blockNumber: number;
  txHash: string;
  payload: unknown;
  createdAt: string;
}> {
  const rows = db()
    .prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as Array<{
    id: number;
    kind: string;
    block_number: number;
    tx_hash: string;
    payload: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    blockNumber: r.block_number,
    txHash: r.tx_hash,
    payload: (() => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return r.payload;
      }
    })(),
    createdAt: r.created_at,
  }));
}

// --- indexer cursor ---

export function getIndexerLastBlock(): number | null {
  const row = db().prepare("SELECT value FROM meta WHERE key = 'indexer_last_block'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : null;
}

export function setIndexerLastBlock(block: number): void {
  db()
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('indexer_last_block', ?)")
    .run(String(block));
}

// --- idempotency ---

export function alreadyIndexed(txHash: string, logIndex: number): boolean {
  const row = db()
    .prepare("SELECT 1 FROM indexed_logs WHERE tx_hash = ? AND log_index = ?")
    .get(txHash, logIndex);
  return !!row;
}

export function markIndexed(txHash: string, logIndex: number, blockNumber: number): void {
  db()
    .prepare("INSERT OR IGNORE INTO indexed_logs (tx_hash, log_index, block_number) VALUES (?, ?, ?)")
    .run(txHash, logIndex, blockNumber);
}

// --- capability mutations ---

export function upsertIndexedCapability(c: {
  capabilityId: bigint;
  creator: string;
  bond: bigint;
  capabilityType: string;
  metadataCID: string;
  blockTimestamp: number;
}): void {
  db()
    .prepare(
      `INSERT INTO capabilities
         (capability_id, creator, bond, capability_type, metadata_cid, certified, slashed, registered_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT(capability_id) DO UPDATE SET
         creator = excluded.creator,
         bond = excluded.bond,
         capability_type = excluded.capability_type,
         metadata_cid = excluded.metadata_cid`,
    )
    .run(
      Number(c.capabilityId),
      c.creator.toLowerCase(),
      c.bond.toString(),
      c.capabilityType.toLowerCase(),
      c.metadataCID,
      new Date(c.blockTimestamp * 1000).toISOString(),
    );
}

export function certifyIndexedCapability(capabilityId: bigint): void {
  db().prepare("UPDATE capabilities SET certified = 1 WHERE capability_id = ?").run(Number(capabilityId));
}

export function slashIndexedCapability(capabilityId: bigint): void {
  db().prepare("UPDATE capabilities SET slashed = 1 WHERE capability_id = ?").run(Number(capabilityId));
}

export function deleteIndexedCapability(capabilityId: bigint): void {
  db().prepare("DELETE FROM capabilities WHERE capability_id = ?").run(Number(capabilityId));
}

// --- agent score components ---

export function bumpAgent(
  agent: string,
  delta: { completions?: number; confirmed?: number; disputes?: number; lastActivity?: number },
): void {
  db()
    .prepare(
      `INSERT INTO agent_scores (agent, completions, confirmed, disputes, last_activity)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET
         completions = agent_scores.completions + excluded.completions,
         confirmed = MAX(0, agent_scores.confirmed + excluded.confirmed),
         disputes = agent_scores.disputes + excluded.disputes,
         last_activity = MAX(agent_scores.last_activity, excluded.last_activity)`,
    )
    .run(
      agent.toLowerCase(),
      delta.completions ?? 0,
      delta.confirmed ?? 0,
      delta.disputes ?? 0,
      delta.lastActivity ?? 0,
    );
}

export function recordIndexedCompletion(c: {
  completionId: bigint;
  agent: string;
  taskType: string;
  resultCID: string;
  timestamp: number;
  txHash: string;
}): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO completions
         (completion_id, agent, task_type, result_cid, timestamp, challenged, disputed, tx_hash, recorded_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(
      Number(c.completionId),
      c.agent.toLowerCase(),
      c.taskType.toLowerCase(),
      c.resultCID,
      c.timestamp,
      c.txHash,
      new Date().toISOString(),
    );
}

export function getCompletionAgent(completionId: bigint): string | null {
  const row = db().prepare("SELECT agent FROM completions WHERE completion_id = ?").get(Number(completionId)) as
    | { agent: string }
    | undefined;
  return row?.agent ?? null;
}

export function addReceiptIndex(completionId: bigint, agent: string, counterparty: string, ts: number): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO completion_receipts (completion_id, agent, counterparty, receipt_ts)
       VALUES (?, ?, ?, ?)`,
    )
    .run(Number(completionId), agent.toLowerCase(), counterparty.toLowerCase(), ts);
}

export function getReceiptAgent(completionId: bigint): string | null {
  const row = db()
    .prepare("SELECT agent FROM completion_receipts WHERE completion_id = ?")
    .get(Number(completionId)) as { agent: string } | undefined;
  return row?.agent ?? null;
}

export function deleteReceiptIndex(completionId: bigint): void {
  db().prepare("DELETE FROM completion_receipts WHERE completion_id = ?").run(Number(completionId));
}

// --- identity ---

export function setAgentIdentity(agent: string, metadataCID: string): void {
  db()
    .prepare("INSERT OR REPLACE INTO agent_identity (agent, metadata_cid) VALUES (?, ?)")
    .run(agent.toLowerCase(), metadataCID);
}

export function getAgentIdentity(agent: string): string {
  const row = db()
    .prepare("SELECT metadata_cid FROM agent_identity WHERE agent = ?")
    .get(agent.toLowerCase()) as { metadata_cid: string } | undefined;
  return row?.metadata_cid ?? "";
}

// --- queries used by /api/discover ---

export interface IndexedCapabilityRow {
  capability_id: number;
  creator: string;
  bond: string;
  capability_type: string;
  metadata_cid: string;
  certified: number;
  slashed: number;
  completions: number;
  confirmed: number;
  disputes: number;
  last_activity: number;
}

export function countIndexedCapabilities(capabilityTypeLabel: string): number {
  const type = ethers.id(capabilityTypeLabel).toLowerCase();
  const row = db()
    .prepare(
      "SELECT COUNT(*) AS n FROM capabilities WHERE capability_type = ? AND certified = 1 AND slashed = 0",
    )
    .get(type) as { n: number };
  return row.n;
}

export function queryIndexedCapabilities(capabilityTypeLabel: string): IndexedCapabilityRow[] {
  const type = ethers.id(capabilityTypeLabel).toLowerCase();
  return db()
    .prepare(
      `SELECT c.capability_id, c.creator, c.bond, c.capability_type, c.metadata_cid, c.certified, c.slashed,
              COALESCE(a.completions, 0)   AS completions,
              COALESCE(a.confirmed, 0)     AS confirmed,
              COALESCE(a.disputes, 0)      AS disputes,
              COALESCE(a.last_activity, 0) AS last_activity
       FROM capabilities c
       LEFT JOIN agent_scores a ON a.agent = c.creator
       WHERE c.capability_type = ? AND c.certified = 1 AND c.slashed = 0
       ORDER BY c.capability_id`,
    )
    .all(type) as IndexedCapabilityRow[];
}
