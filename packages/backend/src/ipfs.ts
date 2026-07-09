import "dotenv/config";

/**
 * Pinata IPFS pinning client. Pins JSON metadata and text evidence to IPFS
 * so the demo's `resultCID` and `metadataCID` are real, resolvable CIDs.
 */
const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const JWT = process.env.PINATA_JWT;

if (!JWT) {
  console.warn("PINATA_JWT not set — IPFS pinning will return mock CIDs");
}

export interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
  isDuplicate?: boolean;
}

/** Pin a JSON object to IPFS via Pinata. Returns an ipfs://<cid> URI. */
export async function pinJSON(content: Record<string, unknown>, name: string): Promise<string> {
  if (!JWT) {
    return `ipfs://mock-${name}-${Date.now()}`;
  }
  const body = JSON.stringify({ pinataContent: content, pinataMetadata: { name } });
  const r = await fetch(PINATA_PIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body,
  });
  if (!r.ok) {
    throw new Error(`Pinata pin failed: ${r.status} ${await r.text()}`);
  }
  const data = (await r.json()) as PinataPinResponse;
  return `ipfs://${data.IpfsHash}`;
}

/** Build a model-card metadata object for a capability registration. */
export function buildModelCard(opts: {
  name: string;
  baseModel: string;
  loraAdapter: string;
  taskType: string;
  benchmark: string;
  creator: string;
}): Record<string, unknown> {
  return {
    name: opts.name,
    baseModel: opts.baseModel,
    loraAdapter: opts.loraAdapter,
    taskType: opts.taskType,
    benchmark: opts.benchmark,
    creator: opts.creator,
    pinnedAt: new Date().toISOString(),
    schema: "taop-capability-v1",
  };
}

/** Build an evidence object for a completion attestation. */
export function buildEvidence(opts: {
  completionId: number | string;
  agent: string;
  taskType: string;
  input: string;
  output: string;
  modelUsed: string;
}): Record<string, unknown> {
  return {
    completionId: String(opts.completionId),
    agent: opts.agent,
    taskType: opts.taskType,
    input: opts.input,
    output: opts.output,
    modelUsed: opts.modelUsed,
    timestamp: new Date().toISOString(),
    schema: "taop-evidence-v1",
  };
}
