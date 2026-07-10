import { useEffect, useState } from "react";
import type { Contracts, DemoResult, DiscoveryItem } from "./api.js";
import { getContracts, getDiscover, runDemo, challengeCompletion, resolveChallenge } from "./api.js";

const trunc = (a: string, n = 6) => (a.length <= n + 4 ? a : `${a.slice(0, n)}…${a.slice(-4)}`);
const chainLabel = (id: number) =>
  id === 84532 ? "Base Sepolia" : id === 8453 ? "Base" : id === 31337 ? "Local Hardhat" : `Chain ${id}`;

function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "blue" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
    green: "border-emerald-700/60 bg-emerald-900/30 text-emerald-300",
    amber: "border-amber-700/60 bg-amber-900/30 text-amber-300",
    blue: "border-sky-700/60 bg-sky-900/30 text-sky-300",
    rose: "border-rose-700/60 bg-rose-900/30 text-rose-300",
  };
  return (
    <span className={`mono inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function App() {
  const [contracts, setContracts] = useState<Contracts | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryItem[]>([]);
  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [lastResolve, setLastResolve] = useState<any>(null);

  async function refresh() {
    const [c, d] = await Promise.all([getContracts(), getDiscover()]);
    setContracts(c);
    setDiscovery(d);
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setStatus("running");
    try {
      setStatus("attesting");
      const res = await runDemo();
      setDemo(res);
      setStatus("done");
      await refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setStatus("error");
    } finally {
      setRunning(false);
    }
  }

  async function handleChallenge() {
    if (!demo) return;
    setChallenging(true);
    setError(null);
    try {
      await challengeCompletion(demo.completionId);
      const res = await resolveChallenge(demo.completionId, true);
      setLastResolve(res);
      await refresh();
      setStatus("challenged");
      if (res.scheduled) {
        setError(`Resolve scheduled (delay ${res.delay}s). ${res.message || ''}`);
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setChallenging(false);
    }
  }

  const agentA = discovery.find((d) => d.agentAddress === demo?.agentAddress) ?? discovery[0];
  const beforeScore = demo ? Number(demo.before.score) : 0;
  const afterScore = demo ? Number(demo.after.score) : agentA?.score ?? 0;
  const beforeCompletions = demo ? Number(demo.before.completions) : 0;
  const beforeDisputes = demo ? Number(demo.before.disputes) : 0;

  const timelockDelaySec = contracts ? Number(contracts.timelockDelay) : 0;
  const isZeroDelay = timelockDelaySec === 0;

  const statusCopy: Record<string, string> = {
    idle: "Agent A is ready. Capability proof verified on-chain (indexed registry).",
    running: "Agent A is running the LoRA summarization model…",
    attesting: "Pinning evidence to IPFS + self-attesting on Base…",
    done: "Completion logged on-chain. Agent A's score updated (subject to decay for inactivity).",
    challenged: "Challenge resolved via Timelock. Score adjusted by dispute.",
    error: "Something went wrong. See below.",
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #64748b 1px, transparent 1px), linear-gradient(to bottom, #64748b 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-10">
        <Hero contracts={contracts} onRun={handleRun} running={running} />

        <InvestorSection contracts={contracts} />

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <PanelA
            agentA={agentA}
            contracts={contracts}
            running={running}
            onRun={handleRun}
            status={statusCopy[status] ?? statusCopy.idle}
            statusKey={status}
            onChallenge={handleChallenge}
            challenging={challenging}
            hasDemo={!!demo}
          />
          <PanelB
            demo={demo}
            contracts={contracts}
            beforeScore={beforeScore}
            afterScore={afterScore}
            beforeCompletions={beforeCompletions}
            beforeDisputes={beforeDisputes}
          />
        </div>

        <div className="mt-6">
          <PanelC
            discovery={discovery}
            contracts={contracts}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        </div>

        <Footer contracts={contracts} />

        {error && (
          <div className="mt-6 rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
            <span className="mono">error:</span> {error}
          </div>
        )}
      </div>
    </div>
  );
}

function InvestorSection({ contracts }: { contracts: Contracts | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="fade-up mt-6 rounded-2xl border border-indigo-900/40 bg-gradient-to-br from-indigo-950/30 to-slate-900/40 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            For investors
          </span>
          <span className="text-sm text-slate-400">TAOP in 60 seconds →</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500 hover:text-indigo-300"
        >
          {open ? "Hide" : "Read the pitch"}
        </button>
      </div>

      {open && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Problem */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-rose-300">The problem</h3>
            <p className="mt-2 text-sm text-slate-300">
              AI agents need to discover, verify, and trust each other to collaborate. Today they rely on
              <span className="text-slate-100"> centralized platforms</span> — OpenAI, Hugging Face,
              LangChain Hub — that can change terms, de-list agents, or gatekeep. Every decentralized AI
              protocol (Fetch.ai, SingularityNET, Olas) ships a marketplace but
              <span className="text-slate-100"> no trustless reputation layer</span>. So quality is
              unverifiable and fraud is unpoliceable.
            </p>
          </div>

          {/* Solution */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">The solution</h3>
            <p className="mt-2 text-sm text-slate-300">
              TAOP is the <span className="text-slate-100">invisible reputation layer for the agent economy</span>.
              Two contracts on Base: a <span className="text-slate-100">Credit Bureau</span> where agents
              self-attest completions and anyone can challenge fraud with an ETH bond, and a
              <span className="text-slate-100"> LoRA Guilds registry</span> where capability creators bond
              ETH and get slashed for fake models. Score = completions − disputes. No platform in the middle.
            </p>
          </div>

          {/* Traction */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-sky-300">Live now</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
              <li>● Contracts deployed on <span className="text-slate-100">Base Sepolia</span> — real txs, real ETH bonds</li>
              <li>● <span className="text-slate-100">Score decay</span> via lastActivity (halves every 30d inactivity)</li>
              <li>● <span className="text-slate-100">Indexed discovery</span> (O(1) getCapabilitiesByType)</li>
              <li>● <span className="text-slate-100">Timelock</span> for admin actions (0-delay for demo)</li>
              <li>● <span className="text-slate-100">Python SDK</span> + external Agent B proving discovery → use → verify</li>
            </ul>
            {contracts && (
              <a
                href={`${contracts.explorerBase}/address/${contracts.ron}`}
                target="_blank"
                rel="noreferrer"
                className="mono mt-3 inline-block text-xs text-sky-300 hover:underline"
              >
                Verify on Basescan ↗
              </a>
            )}
          </div>

          {/* Market + model + ask */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-300">Market & ask</h3>
            <p className="mt-2 text-sm text-slate-300">
              <span className="text-slate-100">Market:</span> The AI agent economy is emerging fast —
              LangChain, AutoGPT, CrewAI, OpenAI Agents SDK — but every framework lacks a shared, trustless
              reputation + capability layer. TAOP is protocol-neutral: any framework's agents can use it.
            </p>
            <p className="mt-2 text-sm text-slate-300">
              <span className="text-slate-100">Model:</span> Protocol fee on capability registration + a
              challenge-bond cut when disputes are upheld. v2 adds an A2A hiring marketplace (escrow + milestones).
            </p>
            <p className="mt-2 text-sm text-slate-300">
              <span className="text-slate-100">Ask:</span> Pre-seed / Base Ecosystem Grant to fund a
              professional audit + mainnet deployment. <a href="mailto:hello@taop.network" className="text-amber-300 hover:underline">Get in touch ↗</a>
            </p>
          </div>

          {/* Bottom: links */}
          <div className="md:col-span-2 flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
            <span className="text-slate-500">Deep dive:</span>
            <a className="text-slate-300 hover:text-indigo-300" href="/api/docs/" target="_blank" rel="noreferrer">API docs</a>
            <a className="text-slate-300 hover:text-indigo-300" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <span className="text-slate-500">·</span>
            <span className="text-slate-500">One-pager PDF:</span>
            <a className="text-slate-300 hover:text-indigo-300" href="/one-pager.html" target="_blank" rel="noreferrer">Open ↗</a>
            <span className="text-slate-500">(print to PDF from the browser)</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Hero({ contracts, onRun, running }: { contracts: Contracts | null; onRun: () => void; running: boolean }) {
  return (
    <header className="fade-up relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-indigo-300">
          <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-indigo-400" />
          TAOP · Credit Bureau + LoRA Guilds
        </div>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Trustless reputation for AI agents.{" "}
          <span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">On Base.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          Self-attest completions · public challenge with ETH bonds · score = completions − disputes (decays over inactivity). Indexed discovery (O(1)). Timelock-protected admin. No platform in the middle.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-emerald-800 px-2 py-0.5">Score Decay</span>
          <span className="rounded bg-sky-800 px-2 py-0.5">Indexed Discovery</span>
          <span className="rounded bg-amber-800 px-2 py-0.5">Timelock Admin</span>
          <span className="rounded bg-purple-800 px-2 py-0.5">MCP + @taopp/sdk</span>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            onClick={onRun}
            disabled={running}
            className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running…" : "Run the live demo"}
          </button>
          <a
            href={contracts ? `${contracts.explorerBase}/address/${contracts.ron}` : "#"}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-700 px-5 py-2.5 font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/40"
          >
            Read the contracts
          </a>
          {contracts && (
            <span className="mono ml-1 text-xs text-slate-400">
              {chainLabel(contracts.chainId)} · RON {trunc(contracts.ron)} · Timelock {contracts.timelock ? trunc(contracts.timelock) : 'N/A'} (delay {Number(contracts.timelockDelay)}s)
            </span>
          )}
          {contracts && (
            <span className={`mono text-xs ${isZeroDelay ? 'text-green-400' : 'text-amber-400'}`}>
              {isZeroDelay ? 'Demo mode (0 delay)' : 'Hardened mode'}
            </span>
          )}
        </div>
        {contracts && (
          <div className="mt-2 text-xs text-slate-400">
            Timelock: {contracts.timelock ? trunc(contracts.timelock) : 'N/A'} • Delay: {contracts.timelockDelay}s
            {isZeroDelay && ' (demo-friendly, set TIMELOCK_DELAY for real delay)'}
          </div>
        )}
      </div>
    </header>
  );
}

function PanelA({
  agentA,
  contracts,
  running,
  onRun,
  status,
  statusKey,
  onChallenge,
  challenging,
  hasDemo,
}: {
  agentA?: DiscoveryItem;
  contracts: Contracts | null;
  running: boolean;
  onRun: () => void;
  status: string;
  statusKey: string;
  onChallenge: () => void;
  challenging: boolean;
  hasDemo: boolean;
}) {
  return (
    <section className="fade-up rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Panel A · Agent A self-attests</h2>
        <Chip tone="blue">LoRA</Chip>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">Capability</div>
            <div className="mono text-base text-slate-100">
              {contracts ? `#${contracts.capabilityId} · summarization` : "loading…"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip tone="green">certified ✓</Chip>
            <Chip tone="amber">{agentA?.bond ?? "0.01"} ETH bond</Chip>
            <Chip>creator {agentA ? trunc(agentA.agentAddress) : contracts ? trunc(contracts.agentA) : "…"}</Chip>
          </div>
        </div>
        <div className="mono mt-3 truncate text-xs text-slate-500">
          {agentA?.metadataCID ?? "ipfs://taop-demo-lora-summarization-v1"}
        </div>
      </div>

      <button
        onClick={onRun}
        disabled={running}
        className="mt-5 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3 font-medium text-white transition hover:from-indigo-400 hover:to-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Running LoRA summarization…" : "Run Agent A's summarization task"}
      </button>

      {hasDemo && (
        <button
          onClick={onChallenge}
          disabled={challenging || running}
          className="mt-3 w-full rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-2.5 text-sm font-medium text-rose-300 transition hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {challenging ? "Resolving challenge…" : "Challenge this completion (fraud simulation)"}
        </button>
      )}

      {lastResolve && (
        <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs">
          <div className="font-medium text-amber-300">Timelock outcome</div>
          <div className="mono mt-1 text-amber-200">
            {lastResolve.executed ? "✅ Executed immediately" : "⏳ Scheduled"}
            {lastResolve.delay ? ` (delay ${lastResolve.delay}s)` : ""}
          </div>
          {lastResolve.message && <div className="mt-1 text-amber-300">{lastResolve.message}</div>}
          <div className="mt-1 text-[10px] text-amber-400">Admin actions protected by TimelockController (0 delay for demo)</div>
        </div>
      )}

      <div
        className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          statusKey === "done"
            ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300"
            : statusKey === "error"
              ? "border-rose-800/60 bg-rose-950/30 text-rose-300"
              : statusKey === "challenged"
                ? "border-amber-800/60 bg-amber-950/30 text-amber-300"
                : "border-slate-800 bg-slate-950/40 text-slate-300"
        }`}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            statusKey === "done"
              ? "bg-emerald-400"
              : statusKey === "error"
                ? "bg-rose-400"
                : statusKey === "challenged"
                  ? "bg-amber-400"
                  : "bg-indigo-400 pulse-ring"
          }`}
        />
        {status}
      </div>
    </section>
  );
}

function PanelB({
  demo,
  contracts,
  beforeScore,
  afterScore,
  beforeCompletions,
  beforeDisputes,
}: {
  demo: DemoResult | null;
  contracts: Contracts | null;
  beforeScore: number;
  afterScore: number;
  beforeCompletions: number;
  beforeDisputes: number;
}) {
  return (
    <section className="fade-up rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Panel B · Watch on Base</h2>
        <Chip tone="green">on-chain</Chip>
      </div>

      {!demo ? (
        <div className="mt-6 flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-800 text-sm text-slate-500">
          No completion yet. Run the demo to self-attest on-chain.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <TxField label="attestCompletion tx" hash={demo.attestTx} chainId={contracts?.chainId} />

          {/* Real LoRA output */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-slate-500">Real LoRA summarization output</div>
              <Chip tone="blue">{demo.latencyMs}ms</Chip>
            </div>
            <div className="mono mt-1 text-xs text-slate-500">model: {demo.modelUsed}</div>
            <div className="mt-2 rounded-lg bg-slate-900/80 p-3 text-sm text-slate-200">
              {demo.summary || <span className="text-slate-500">(empty output)</span>}
            </div>
            <details className="mt-2">
              <summary className="mono cursor-pointer text-xs text-slate-500 hover:text-slate-300">input corpus</summary>
              <div className="mt-1 rounded-lg bg-slate-900/80 p-2 text-xs text-slate-400">{demo.inputCorpus}</div>
            </details>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Completion record</div>
            <div className="mono mt-2 space-y-1.5 text-xs text-slate-300">
              <div><span className="text-slate-500">completionId</span> {demo.completionId}</div>
              <div><span className="text-slate-500">agent</span> {trunc(demo.agentAddress)}</div>
              <div><span className="text-slate-500">resultCID</span> <a href={`https://gateway.pinata.cloud/ipfs/${demo.resultCID.replace("ipfs://", "")}`} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">{demo.resultCID.slice(0, 30)}…</a></div>
              <div><span className="text-slate-500">capability</span> #{demo.capabilityId} ({demo.capability.capabilityType})</div>
              <div><span className="text-slate-500">bond</span> {demo.capability.bond} ETH</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Score before → after (with decay)</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="mono text-2xl font-semibold text-slate-300">
                {beforeCompletions === 0 && beforeDisputes === 0 ? "unrated" : beforeScore}
              </div>
              <span className="text-slate-600">→</span>
              <div className="mono text-2xl font-semibold text-emerald-300">{afterScore}</div>
              <Chip tone="green">+{afterScore - beforeScore}</Chip>
              <span className="mono ml-auto text-xs text-slate-500">
                {demo.after.completions} completions · {demo.after.disputes} disputes
              </span>
            </div>
            <div className="mono mt-2 text-xs text-slate-500">score = completions − disputes (decays with inactivity via lastActivity on RON)</div>
          </div>
        </div>
      )}
    </section>
  );
}

function TxField({ label, hash, chainId }: { label: string; hash: string | null; chainId?: number }) {
  const href = hash && chainId
    ? `${chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"}/tx/${hash}`
    : undefined;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      {hash ? (
        <a
          href={href ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="mono mt-1 block truncate text-xs text-emerald-300 hover:underline"
          title={hash}
        >
          {hash}
        </a>
      ) : (
        <div className="mono mt-1 text-xs text-slate-600">—</div>
      )}
    </div>
  );
}

function PanelC({
  discovery,
  contracts,
  expanded,
  setExpanded,
}: {
  discovery: DiscoveryItem[];
  contracts: Contracts | null;
  expanded: boolean;
  setExpanded: (b: boolean) => void;
}) {
  return (
    <section className="fade-up rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Panel C · Agent B discovers Agent A (indexed)
        </h2>
        <div className="flex items-center gap-2">
          <Chip tone="blue">indexed on-chain</Chip>
          <Chip>min score 0</Chip>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
        <div className="bg-slate-950/60 px-4 py-1.5 text-xs text-slate-500">
          Discovered via on-chain indexed registry (getCapabilitiesByType — O(1) lookup)
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-4 py-2.5">Capability</th>
              <th className="px-4 py-2.5">Bond</th>
              <th className="px-4 py-2.5">Score</th>
              <th className="px-4 py-2.5">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {discovery.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No certified capabilities yet. Run the demo to register and self-attest.
                </td>
              </tr>
            ) : (
              discovery.map((d) => (
                <tr
                  key={d.agentAddress + d.capabilityId}
                  className="cursor-pointer transition hover:bg-slate-800/30"
                  onClick={() => setExpanded(!expanded)}
                >
                  <td className="px-4 py-3">
                    <div className="mono text-slate-200">{trunc(d.agentAddress)}</div>
                    <div className="mono text-xs text-slate-500">
                      {d.completions} completions · {d.disputes} disputes
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Chip tone="blue">{d.capabilityType}</Chip>
                      <Chip tone="green">certified</Chip>
                      {d.slashed && <Chip tone="rose">slashed</Chip>}
                    </div>
                    <div className="mono mt-1 text-xs text-slate-500">cap #{d.capabilityId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone="amber">{d.bond} ETH</Chip>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mono text-lg text-emerald-300">{d.score}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-sky-300">view evidence ↗</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {expanded && contracts && (
        <div className="fade-up mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">On-chain verification (you just did this)</div>
          <div className="mono mt-2 space-y-1 text-xs text-slate-300">
            <div><span className="text-slate-500">ReputationOracleNetwork.getSelfAttestScore(agent)</span></div>
            <div><span className="text-slate-500">CapabilityRegistry.getCapability(id)</span></div>
            <div><span className="text-slate-500">chain</span> {chainLabel(contracts.chainId)}</div>
            <div><span className="text-slate-500">RON</span> {contracts.ron}</div>
            <div><span className="text-slate-500">Registry</span> {contracts.registry}</div>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            You just verified this yourself. No platform vouched for Agent A.
          </p>
        </div>
      )}
    </section>
  );
}

function Footer({ contracts }: { contracts: Contracts | null }) {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-6 text-sm text-slate-400">
      <div className="flex flex-wrap items-center gap-4">
        <span className="mono text-slate-500">TAOP — the invisible reputation layer for the agent economy.</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {contracts && (
          <a className="hover:text-slate-200" href={`${contracts.explorerBase}/address/${contracts.ron}`} target="_blank" rel="noreferrer">
            contracts
          </a>
        )}
        <a className="hover:text-slate-200" href="/api/docs/" target="_blank" rel="noreferrer">API docs</a>
        <a className="hover:text-slate-200" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </footer>
  );
}
