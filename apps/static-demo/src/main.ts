import { ethers } from "ethers";
import { ReputationOracleNetworkClient, CapabilityRegistryClient, discover } from "@taopp/sdk";
import deploymentRaw from "../../../deployments.json.example?raw";
import "./style.css";

interface Deployment {
  chainId: number;
  network?: string;
  ron: string;
  registry: string;
  timelock?: string;
}

const deployment = JSON.parse(deploymentRaw) as Deployment;

const params = new URLSearchParams(location.search);
const RPC = params.get("rpc") || "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC, deployment.chainId);

const ron = new ReputationOracleNetworkClient(deployment.ron, provider);
const registry = new CapabilityRegistryClient(deployment.registry, provider);

const explorer = deployment.chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
const short = (a: string, n = 6) => (a.length <= n + 4 ? a : `${a.slice(0, n)}…${a.slice(-4)}`);
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

interface Row {
  agentAddress: string;
  capabilityId: string;
  bond: string;
  certified: boolean;
  slashed: boolean;
  metadataCID: string;
  identityCID: string;
  completions: number;
  disputes: number;
  score: number;
  scoreType: string;
}

function renderShell(): void {
  document.querySelector<HTMLElement>("#app")!.innerHTML = `
    <header>
      <h1>TAOP <span class="muted">· read-only demo</span></h1>
      <p class="muted">
        Agent reputation + capability registry on ${esc(deployment.network ?? "chain")}.
        This page reads the contracts <strong>directly from a public RPC</strong> — no backend, no wallet, no keys, no writes.
      </p>
      <div class="row">
        <a href="${explorer}/address/${deployment.ron}" target="_blank" rel="noreferrer">RON ${short(deployment.ron)}</a>
        <a href="${explorer}/address/${deployment.registry}" target="_blank" rel="noreferrer">Registry ${short(deployment.registry)}</a>
        <span class="muted">rpc: ${esc(RPC)}</span>
        <button id="refresh">Refresh</button>
      </div>
    </header>
    <section id="status" class="status">Loading on-chain state…</section>
    <section id="results"></section>
    <footer class="muted">
      Read-only. To self-attest, countersign receipts, or challenge, run the write-enabled backend
      locally (<code>npm run backend:dev</code>) — never expose it without <code>TAOP_API_KEY</code>.
    </footer>`;

  document.querySelector<HTMLButtonElement>("#refresh")!.addEventListener("click", () => void load());
}

async function load(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>("#status")!;
  const resultsEl = document.querySelector<HTMLElement>("#results")!;
  statusEl.textContent = "Loading on-chain state…";
  resultsEl.innerHTML = "";

  try {
    const items = await discover(registry, ron, "LoRA", 0);
    const rows: Row[] = [];
    for (const it of items) {
      let identityCID = "";
      try {
        identityCID = await ron.getAgentMetadata(it.agentAddress);
      } catch {
        /* pre-identity contract */
      }
      rows.push({
        agentAddress: it.agentAddress,
        capabilityId: it.capabilityId.toString(),
        bond: ethers.formatEther(it.bond),
        certified: it.certified,
        slashed: it.slashed,
        metadataCID: it.metadataCID,
        identityCID,
        completions: Number(it.completions),
        disputes: Number(it.disputes),
        score: Number(it.score),
        scoreType: it.scoreType,
      });
    }

    const block = await provider.getBlockNumber();
    statusEl.textContent = `${rows.length} certified LoRA capabilit${rows.length === 1 ? "y" : "ies"} · block ${block} · RPC ${RPC}`;

    if (rows.length === 0) {
      resultsEl.innerHTML = `<p class="muted">No certified capabilities found yet.</p>`;
      return;
    }

    resultsEl.innerHTML = `
      <table>
        <thead><tr><th>Agent</th><th>Capability</th><th>Bond</th><th>Score (${esc(rows[0].scoreType)})</th><th>Evidence</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td class="mono">${short(r.agentAddress)}${r.identityCID ? `<div class="muted small">id: ${esc(r.identityCID.slice(0, 24))}…</div>` : ""}</td>
              <td>#${esc(r.capabilityId)} · LoRA ${r.certified ? '<span class="chip ok">certified</span>' : ""} ${r.slashed ? '<span class="chip bad">slashed</span>' : ""}</td>
              <td class="mono">${esc(r.bond)} ETH</td>
              <td class="score">${r.score}<div class="muted small">${r.completions} confirmed · ${r.disputes} disputes</div></td>
              <td><a href="${r.metadataCID.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(r.metadataCID.slice(7))}` : "#"}" target="_blank" rel="noreferrer">metadata ↗</a></td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  } catch (e) {
    statusEl.textContent = "Could not read on-chain state.";
    const msg = String((e as Error).message ?? e);
    resultsEl.innerHTML = `<pre class="error">${esc(msg)}</pre>
      <p class="muted">Public RPCs can rate-limit or block browser requests. Retry, or open this page with
      <code>?rpc=&lt;another-base-sepolia-rpc&gt;</code>.</p>`;
  }
}

renderShell();
void load();
