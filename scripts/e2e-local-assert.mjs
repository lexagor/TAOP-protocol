/**
 * HTTP assertions for the local end-to-end run (driven by scripts/e2e-local.sh).
 * Exercises the full v0.2 flow through the real backend + real contracts.
 */
const BASE = process.env.E2E_BASE || "http://127.0.0.1:4100";

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await req("GET", "/api/healthz");
check("healthz ok", health.status === 200 && health.json?.ok === true, JSON.stringify(health.json));

const run = await req("POST", "/api/demo/run", {});
check("demo/run attests a completion", run.status === 200 && !!run.json?.completionId, JSON.stringify(run.json));
const completionId = run.json?.completionId;
const agent = run.json?.agentAddress;
check("demo/run pinned a result CID", typeof run.json?.resultCID === "string" && run.json.resultCID.startsWith("ipfs://"));

const receipt = await req("POST", `/api/completions/${completionId}/receipt`, { receiptCID: "ipfs://e2e-receipt" });
check("requester receipt recorded", receipt.status === 200 && !!receipt.json?.txHash, JSON.stringify(receipt.json));

const score = await req("GET", `/api/agents/${agent}/score`);
check("score is two-sided after receipt", score.json?.rankingScoreType === "two-sided" && Number(score.json?.confirmed) >= 1, JSON.stringify(score.json));

const challenge = await req("POST", `/api/completions/${completionId}/challenge`, { evidenceCID: "ipfs://e2e-evidence" });
check("challenge submitted", challenge.status === 200, JSON.stringify(challenge.json));

const contest = await req("POST", `/api/completions/${completionId}/contest`, { rebuttalCID: "ipfs://e2e-rebuttal" });
check("agent contested the challenge", contest.status === 200, JSON.stringify(contest.json));

const earlyFinalize = await req("POST", `/api/completions/${completionId}/finalize`, {});
check("finalize rejected while contested/in-window (400)", earlyFinalize.status === 400, `status=${earlyFinalize.status}`);

const resolve = await req("POST", `/api/completions/${completionId}/resolve`, { upheld: true });
check("owner resolved via Timelock", resolve.status === 200 && resolve.json?.upheld === true, JSON.stringify(resolve.json));

const discover = await req("GET", "/api/discover?capabilityType=LoRA&limit=10");
check(
  "discover returns the agent",
  discover.status === 200 && Array.isArray(discover.json) && discover.json.some((d) => d.agentAddress?.toLowerCase() === agent?.toLowerCase()),
  `status=${discover.status} count=${Array.isArray(discover.json) ? discover.json.length : "n/a"}`,
);

// Indexer should catch up; the on-chain fallback is also valid, so only report.
for (let i = 0; i < 20; i++) {
  const d = await req("GET", "/api/discover?capabilityType=LoRA&limit=1");
  if (d.headers.get("x-indexer") === "on") break;
  await sleep(1000);
}
const indexed = await req("GET", "/api/discover?capabilityType=LoRA&limit=1");
console.log(`  INFO discovery served from index: ${indexed.headers.get("x-indexer")}`);

const ix = await req("GET", "/api/indexer");
check("indexer reports enabled", ix.json?.enabled === true, JSON.stringify(ix.json));

if (failures > 0) {
  console.error(`\nE2E FAILED: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll E2E checks passed");
