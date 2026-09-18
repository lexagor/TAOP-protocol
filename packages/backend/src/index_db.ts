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
    CREATE TABLE IF NOT EXISTS counterparty_confirmations (
      agent TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent, counterparty)
    );
    CREATE TABLE IF NOT EXISTS agent_diversity (
      agent TEXT PRIMARY KEY,
      distinct_count INTEGER NOT NULL DEFAULT 0
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

/** Alerts newer than `afterId`, oldest first, for the webhook dispatcher. */
export function listAlertsAfter(afterId: number, limit = 50): ReturnType<typeof listAlerts> {
  const rows = db()
    .prepare("SELECT * FROM alerts WHERE id > ? ORDER BY id ASC LIMIT ?")
    .all(afterId, Math.min(Math.max(limit, 1), 500)) as Array<{
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

/** Number of alerts newer than `afterId` (webhook backlog). */
export function countAlertsAfter(afterId: number): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM alerts WHERE id > ?").get(afterId) as {
    n: number;
  };
  return row.n;
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

export function getIndexerLastHash(): string | null {
  const row = db().prepare("SELECT value FROM meta WHERE key = 'indexer_last_hash'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setIndexerLastHash(hash: string): void {
  db()
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('indexer_last_hash', ?)")
    .run(hash);
}

/**
 * Drop the indexer's derived state so it can be rebuilt from logs after a reorg.
 * Only indexer-owned tables are cleared: `capabilities` (shared with the demo
 * cache) and `completions` are re-upserted as logs are replayed.
 */
export function resetIndexerDerived(): void {
  db().exec(`
    DELETE FROM agent_scores;
    DELETE FROM completion_receipts;
    DELETE FROM agent_identity;
    DELETE FROM indexed_logs;
  `);
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

// --- retention (disk-exhaustion hardening) ---

/**
 * Keep only the newest `keep` alerts. Rows with an id greater than
 * `keepAboveId` are never removed — the webhook dispatcher passes its delivery
 * cursor here so an undelivered alert can't be pruned away. Returns the number
 * of rows deleted.
 */
export function pruneAlerts(keep: number, keepAboveId = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  // OFFSET keep gives the first row *older* than the N newest; deleting id <= it
  // leaves exactly the newest N.
  const cutoffRow = db()
    .prepare("SELECT id FROM alerts ORDER BY id DESC LIMIT 1 OFFSET ?")
    .get(Math.floor(keep)) as { id: number } | undefined;
  if (!cutoffRow) return 0;
  const cutoff = Math.min(cutoffRow.id, keepAboveId);
  if (cutoff <= 0) return 0;
  const info = db().prepare("DELETE FROM alerts WHERE id <= ?").run(cutoff);
  return Number(info.changes);
}

/**
 * Drop idempotency markers for blocks older than `currentBlock - keepBlocks`.
 * The indexer cursor guarantees those ranges are never re-scanned, and a reorg
 * rebuild clears the table anyway.
 */
export function pruneIndexedLogs(currentBlock: number, keepBlocks: number): number {
  if (!Number.isFinite(keepBlocks) || keepBlocks <= 0) return 0;
  const cutoff = currentBlock - Math.floor(keepBlocks);
  if (cutoff <= 0) return 0;
  const info = db().prepare("DELETE FROM indexed_logs WHERE block_number < ?").run(cutoff);
  return Number(info.changes);
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

/**
 * Track per-(agent, counterparty) confirmation counts and the distinct count
 * (v0.3 diversity signal), mirroring the contract.
 */
export function bumpCounterparty(agent: string, counterparty: string, delta: 1 | -1): void {
  const a = agent.toLowerCase();
  const cp = counterparty.toLowerCase();
  const row = db()
    .prepare("SELECT count FROM counterparty_confirmations WHERE agent = ? AND counterparty = ?")
    .get(a, cp) as { count: number } | undefined;
  const cur = row?.count ?? 0;
  const next = cur + delta;
  if (next <= 0) {
    db().prepare("DELETE FROM counterparty_confirmations WHERE agent = ? AND counterparty = ?").run(a, cp);
    if (cur > 0) {
      db().prepare("UPDATE agent_diversity SET distinct_count = MAX(0, distinct_count - 1) WHERE agent = ?").run(a);
    }
  } else {
    db()
      .prepare(
        `INSERT INTO counterparty_confirmations (agent, counterparty, count) VALUES (?, ?, ?)
         ON CONFLICT(agent, counterparty) DO UPDATE SET count = excluded.count`,
      )
      .run(a, cp, next);
    if (cur === 0) {
      db()
        .prepare(
          `INSERT INTO agent_diversity (agent, distinct_count) VALUES (?, 1)
           ON CONFLICT(agent) DO UPDATE SET distinct_count = agent_diversity.distinct_count + 1`,
        )
        .run(a);
    }
  }
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

export function getReceiptCounterparty(completionId: bigint): string | null {
  const row = db()
    .prepare("SELECT counterparty FROM completion_receipts WHERE completion_id = ?")
    .get(Number(completionId)) as { counterparty: string } | undefined;
  return row?.counterparty ?? null;
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
  distinct_count: number;
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
              COALESCE(d.distinct_count, 0) AS distinct_count,
              COALESCE(a.disputes, 0)      AS disputes,
              COALESCE(a.last_activity, 0) AS last_activity
       FROM capabilities c
       LEFT JOIN agent_scores a ON a.agent = c.creator
       LEFT JOIN agent_diversity d ON d.agent = c.creator
       WHERE c.capability_type = ? AND c.certified = 1 AND c.slashed = 0
       ORDER BY c.capability_id`,
    )
    .all(type) as IndexedCapabilityRow[];
}
