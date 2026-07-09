const BASE = "/api";

export interface Contracts {
  chainId: number;
  ron: string;
  registry: string;
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
  const r = await fetch(url, init);
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
  json<{ txHash: string | null; upheld: boolean }>(`${BASE}/completions/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upheld }),
  });