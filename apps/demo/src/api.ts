const BASE = "/api";

/**
 * Optional API key for write routes. The backend requires `X-TAOP-Key` on all
 * non-GET /api routes whenever TAOP_API_KEY is set on the server (mandatory for
 * any non-loopback deployment). Build the demo with the same value:
 *   VITE_TAOP_API_KEY=<same value> npm run demo:build
 * Local development (HOST=127.0.0.1, no key) needs nothing.
 */
const API_KEY = (import.meta.env.VITE_TAOP_API_KEY ?? "").trim();

export interface Contracts {
  chainId: number;
  ron: string;
  registry: string;
  timelock: string | null;
  timelockDelay: string;
  validator: string;
  agentA: string;
  capabilityId: string;
  explorerBase: string;
}

export interface DiscoveryItem {
  agentAddress: string;
  capabilityId: string;
  capabilityType: string;
  certified: boolean;
  slashed: boolean;
  bond: string;
  metadataCID: string;
  identityCID: string;
  completions: number;
  disputes: number;
  score: number;
}

export interface Score {
  completions: string;
  disputes: string;
  score: string;
}

export interface DemoResult {
  agentAddress: string;
  capabilityId: string;
  capability: {
    creator: string;
    bond: string;
    capabilityType: string;
    metadataCID: string;
    certified: boolean;
    slashed: boolean;
  };
  completionId: string;
  taskType: string;
  resultCID: string;
  summary: string;
  inputCorpus: string;
  modelUsed: string;
  latencyMs: number;
  before: { completions: string; disputes: string; score: string };
  after: { completions: string; disputes: string; score: string };
  attestTx: string | null;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) };
  if (API_KEY) headers["X-TAOP-Key"] = API_KEY;
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const getContracts = () => json<Contracts>(`${BASE}/contracts`);
export const getDiscover = () =>
  json<DiscoveryItem[]>(`${BASE}/discover?capabilityType=LoRA&minScore=0`);
export const getScore = (address: string) => json<Score>(`${BASE}/agents/${address}/score`);
export const runDemo = () =>
  json<DemoResult>(`${BASE}/demo/run`, { method: "POST", headers: { "Content-Type": "application/json" } });
export const challengeCompletion = (id: string) =>
  json<{ txHash: string | null; bondWei: string }>(`${BASE}/completions/${id}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ evidenceCID: "ipfs://challenge-evidence" }),
  });
export const resolveChallenge = (id: string, upheld: boolean) =>
  json<{ txHash: string | null; upheld: boolean; scheduled?: boolean; executed?: boolean; delay?: string; message?: string }>(`${BASE}/completions/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upheld }),
  });

export const getIdentity = (address: string) => json<{ metadataCID: string }>(`${BASE}/agents/${address}/identity`);
export const registerIdentity = (metadataCID: string) =>
  json<{ txHash: string | null; simulated?: boolean; note?: string }>(`${BASE}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadataCID }),
  });