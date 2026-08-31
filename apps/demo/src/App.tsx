import { useEffect, useState } from "react";
import type { Contracts, DemoResult, DiscoveryItem } from "./api.js";
import { getContracts, getDiscover, runDemo, challengeCompletion, resolveChallenge, getIdentity, registerIdentity } from "./api.js";

const trunc = (a: string, n = 6) => (a.length <= n + 4 ? a : `${a.slice(0, n)}…${a.slice(-4)}`);
const chainLabel = (id: number) =>
  id === 84532 ? "Base Sepolia" : id === 8453 ? "Base" : id === 31337 ? "Local Hardhat" : `Chain ${id}`;

function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "blue" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]",
    green: "border-[var(--color-accent-success)] bg-[var(--color-accent-success)]/20 text-[var(--color-accent-success)]",
    amber: "border-amber-800/60 bg-amber-900/30 text-amber-300",
    blue: "border-[var(--color-accent-secondary)]/60 bg-[var(--color-accent-secondary)]/10 text-[var(--color-accent-secondary)]",
    rose: "border-[var(--color-accent-destructive)]/60 bg-[var(--color-accent-destructive)]/10 text-[var(--color-accent-destructive)]",
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
  const [identity, setIdentity] = useState<string>("");
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('taop-theme') as 'dark' | 'light' | null;
      return saved || 'dark';
    }
    return 'dark';
  });

  // Persist + apply theme class to <html> for global var cascade
  useEffect(() => {
    localStorage.setItem('taop-theme', theme);
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    } else {
      root.classList.remove('theme-light');
      root.classList.add('theme-dark');
    }
  }, [theme]);

  async function refresh() {
    const [c, d] = await Promise.all([getContracts(), getDiscover()]);
    setContracts(c);
    setDiscovery(d);
    // Fetch identity for first discovered agent or demo agent
    const addr = demo?.agentAddress || d[0]?.agentAddress;
    if (addr) {
      try {
        const id = await getIdentity(addr);
        setIdentity(id.metadataCID);
      } catch {}
    }
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
      setLastResolve(null);  // allow challenge on the new demo
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
      setStatus("challenging");
      await challengeCompletion(demo.completionId);
      setLastResolve({}); // hide button immediately (prevents AlreadyChallenged on retry); will be replaced by real result
      setStatus("resolving");
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
    challenging: "Submitting challenge tx (bond posted by challenger)…",
    resolving: "Resolving via Timelock (0-delay demo mode)…",
    done: "Completion logged on-chain. Agent A's score updated (subject to decay for inactivity).",
    challenged: "Challenge resolved via Timelock. Score adjusted by dispute.",
    error: "Something went wrong. See below.",
  };

  const themeClass = theme === 'dark' ? 'theme-dark' : 'theme-light';

  return (
    <div className={`min-h-screen font-sans ${themeClass}`}>
      {/* Linear-style top nav */}
      <nav className="nav sticky top-0 z-50 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[var(--color-text-primary)]">TAOP</span>
        </div>
        <div className="flex items-center gap-4 text-[var(--color-text-secondary)]">
          <a href="#demo" className="hover:text-[var(--color-text-primary)]">Demo</a>
          <a href="#features" className="hover:text-[var(--color-text-primary)]">Features</a>
        </div>
        <div>
          <a href="https://github.com" className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs hover:bg-[var(--color-surface-alt)]">GitHub</a>
        </div>
      </nav>

      <div
        className="pointer-events-none fixed inset-0 opacity-[0.08] bg-grid"
      />
      <div className="relative mx-auto max-w-[1200px] px-6 py-10">
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] transition"
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        <Hero contracts={contracts} onRun={handleRun} running={running} isZeroDelay={isZeroDelay} />

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
            identity={identity}
            lastResolve={lastResolve}
            onRegisterIdentity={async (cid: string) => {
              // Always update the local display immediately for demo purposes.
              setIdentity(cid);
              try {
                const regResult = await registerIdentity(cid);
                // If backend simulated the registration (old contract), avoid a refresh()
                // that would call getIdentity on-chain and clear the value.
                if (!(regResult as any)?.simulated) {
                  await refresh();
                }
              } catch (e) {
                // On-chain register may revert if the deployed RON predates identity feature.
                // The endpoint now returns clean error instead of 404/crash. Show it but keep the UI update.
                setError(String((e as Error).message ?? e));
              }
            }}
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
          <div className="mt-6 rounded-xl border border-[var(--color-accent-destructive)]/60 bg-[var(--color-accent-destructive)]/10 p-4 text-sm text-[var(--color-accent-destructive)]">
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
    <section className="fade-up mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[var(--color-accent-secondary)]/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-secondary)]">
            For investors
          </span>
          <span className="text-sm text-[var(--color-text-secondary)]">TAOP in 60 seconds →</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent-secondary)] hover:text-[var(--color-accent-secondary)]"
        >
          {open ? "Hide" : "Read the pitch"}
        </button>
      </div>

      {open && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Problem */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-crimson">The problem</h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              AI agents need to discover, verify, and trust each other to collaborate. Today they rely on
              <span className="text-[var(--color-text-primary)]"> centralized platforms</span> — OpenAI, Hugging Face,
              LangChain Hub — that can change terms, de-list agents, or gatekeep. Every decentralized AI
              protocol (Fetch.ai, SingularityNET, Olas) ships a marketplace but
              <span className="text-[var(--color-text-primary)]"> no trustless reputation layer</span>. So quality is
              unverifiable and fraud is unpoliceable.
            </p>
          </div>

          {/* Solution */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald">The solution</h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              TAOP is the <span className="text-[var(--color-text-primary)]">invisible reputation layer for the agent economy</span>.
              Two contracts on Base: a <span className="text-[var(--color-text-primary)]">Credit Bureau</span> where agents
              self-attest completions and anyone can challenge fraud with an ETH bond, and a
              <span className="text-[var(--color-text-primary)]"> LoRA Guilds registry</span> where capability creators bond
              ETH and get slashed for fake models. Score = completions − disputes. No platform in the middle.
            </p>
          </div>

          {/* Traction */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-accent-info)]">Live now</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-text-secondary)]">
              <li>● Contracts deployed on <span className="text-[var(--color-text-primary)]">Base Sepolia</span> — real txs, real ETH bonds</li>
              <li>● <span className="text-[var(--color-text-primary)]">Score decay</span> via lastActivity (halves every 30d inactivity) — see on-chain <code>getSelfAttestScore</code></li>
              <li>● <span className="text-[var(--color-text-primary)]">Indexed discovery</span> (O(1) <code>getCapabilitiesByType</code>)</li>
              <li>● <span className="text-[var(--color-text-primary)]">TimelockController</span> for admin (0-delay pilot; real delay for mainnet)</li>
              <li>● Published <span className="text-[var(--color-text-primary)]">@taopp/sdk</span> + <span className="text-[var(--color-text-primary)]">@taopp/mcp-server</span> + Python SDK + Agent B example</li>
            </ul>
            {contracts && (
              <a
                href={`${contracts.explorerBase}/address/${contracts.ron}`}
                target="_blank"
                rel="noreferrer"
                className="mono mt-3 inline-block text-xs text-[var(--color-accent-info)] hover:underline"
              >
                Verify on Basescan ↗
              </a>
            )}
          </div>

          {/* Market + model + ask */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-300">Market & ask</h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-primary)]">Market:</span> The AI agent economy is emerging fast —
              LangChain, AutoGPT, CrewAI, OpenAI Agents SDK — but every framework lacks a shared, trustless
              reputation + capability layer. TAOP is protocol-neutral: any framework's agents can use it.
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-primary)]">Model:</span> Protocol fee on capability registration + a
              challenge-bond cut when disputes are upheld. v2 adds an A2A hiring marketplace (escrow + milestones).
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-primary)]">Ask:</span> Pre-seed / Base Ecosystem Grant to fund a
              professional audit + mainnet deployment. <a href="mailto:hello@taop.network" className="text-amber-300 hover:underline">Get in touch ↗</a>
            </p>
          </div>

          {/* Bottom: links */}
          <div className="md:col-span-2 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-xs">
            <span className="text-[var(--color-text-secondary)]">Deep dive:</span>
            <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-secondary)]" href="/api/docs/" target="_blank" rel="noreferrer">API docs</a>
            <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-secondary)]" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <span className="text-[var(--color-text-secondary)]">·</span>
            <span className="text-[var(--color-text-secondary)]">One-pager PDF:</span>
            <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-secondary)]" href="/one-pager.html" target="_blank" rel="noreferrer">Open ↗</a>
            <span className="text-[var(--color-text-secondary)]">(print to PDF from the browser)</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Hero({ contracts, onRun, running, isZeroDelay }: { contracts: Contracts | null; onRun: () => void; running: boolean; isZeroDelay: boolean }) {
  return (
    <header className="fade-up relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-nav)] p-10" style={{ boxShadow: 'var(--shadow-card-inset)' }}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--color-accent-secondary)]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-[var(--color-accent-info)]/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-[var(--color-accent-secondary)]" />
          TAOP · Credit Bureau + LoRA Guilds
        </div>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ fontWeight: 300, letterSpacing: '-0.624px' }}>
          Trustless reputation for AI agents.{" "}
          <span className="bg-gradient-to-r from-indigo to-cyan bg-clip-text text-transparent">On Base.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-secondary)]">
          Self-attest completions · public challenge with ETH bonds · score = completions − disputes (with decay). Indexed discovery by capability. Timelock for admin. No platform in the middle.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-[var(--color-accent-success)]/20 px-2 py-0.5 text-[var(--color-accent-success)]">Score Decay</span>
          <span className="rounded bg-[var(--color-accent-info)]/20 px-2 py-0.5 text-[var(--color-accent-info)]">Indexed Discovery</span>
          <span className="rounded bg-amber-800/40 px-2 py-0.5 text-amber-300">Timelock Admin</span>
          <span className="rounded bg-purple-800/40 px-2 py-0.5 text-purple-300">MCP + @taopp/sdk + Python</span>
          <a href="https://www.npmjs.com/package/@taopp/sdk" target="_blank" rel="noreferrer" className="rounded bg-emerald-800/40 px-2 py-0.5 text-emerald-300 hover:underline">npm @taopp/sdk</a>
          <a href="https://www.npmjs.com/package/@taopp/mcp-server" target="_blank" rel="noreferrer" className="rounded bg-emerald-800/40 px-2 py-0.5 text-emerald-300 hover:underline">npm @taopp/mcp-server</a>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            onClick={onRun}
            disabled={running}
            className="btn-lime rounded-xl px-5 py-2.5 font-medium shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running…" : "Run the live demo"}
          </button>
          <a
            href={contracts ? `${contracts.explorerBase}/address/${contracts.ron}` : "#"}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost rounded-xl border border-[var(--color-border)] px-5 py-2.5 font-medium text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
          >
            Read the contracts
          </a>
          {contracts && (
            <span className="mono ml-1 text-xs text-[var(--color-text-secondary)]">
              {chainLabel(contracts.chainId)} · RON {trunc(contracts.ron)} · Timelock {contracts.timelock ? trunc(contracts.timelock) : 'N/A'} (delay {Number(contracts.timelockDelay)}s)
            </span>
          )}
          {contracts && (
            <span className={`mono text-xs ${isZeroDelay ? 'text-[var(--color-accent-success)]' : 'text-amber-300'}`}>
              {isZeroDelay ? 'Demo mode (0 delay)' : 'Hardened mode'}
            </span>
          )}
        </div>
        {contracts && (
          <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
            Timelock: {contracts.timelock ? trunc(contracts.timelock) : 'N/A'} • Delay: {contracts.timelockDelay}s
            {isZeroDelay && ' (demo-friendly, 0-delay pilot)'}
          </div>
        )}
        {contracts && (
          <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
            Status: {isZeroDelay ? '0-delay (instant resolve for pilot)' : 'Hardened (actions scheduled, execute after delay)'}
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
  identity = "",
  lastResolve = null,
  onRegisterIdentity,
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
  identity?: string;
  lastResolve?: any;
  onRegisterIdentity: (cid: string) => void | Promise<void>;
}) {
  return (
    <section className="fade-up card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Panel A · Agent A self-attests</h2>
        <Chip tone="blue">LoRA</Chip>
      </div>

      <div className="mt-4 card-inset p-4 bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-[var(--color-text-secondary)]">Capability</div>
            <div className="mono text-base text-[var(--color-text-primary)]">
              {contracts ? `#${contracts.capabilityId} · summarization` : "loading…"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip tone="green">certified ✓</Chip>
            <Chip tone="amber">{agentA?.bond ?? "0.01"} ETH bond</Chip>
            <Chip>creator {agentA ? trunc(agentA.agentAddress) : contracts ? trunc(contracts.agentA) : "…"}</Chip>
          </div>
        </div>
        <div className="mono mt-3 truncate text-xs text-[var(--color-text-secondary)]">
          {agentA?.metadataCID ?? "ipfs://taop-demo-lora-summarization-v1"}
        </div>
        <div className="mono mt-1 text-xs text-[var(--color-text-secondary)]">
          Identity: {identity || "(not registered)"}
        </div>
      </div>

      <button
        onClick={onRun}
        disabled={running}
        className="mt-5 w-full btn-lime transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Running LoRA summarization…" : "Run Agent A's summarization task"}
      </button>

      {hasDemo && !lastResolve && (
        <button
          onClick={onChallenge}
          disabled={challenging || running}
          className="mt-3 w-full rounded-xl border border-[var(--color-accent-destructive)]/60 bg-[var(--color-accent-destructive)]/10 px-4 py-2.5 text-sm font-medium text-[var(--color-accent-destructive)] transition hover:bg-[var(--color-accent-destructive)]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {challenging ? "Challenging + resolving (demo, may take 15-60s on public RPC)…" : "Challenge this completion (fraud simulation)"}
        </button>
      )}

      {hasDemo && (
        <button
          onClick={() => onRegisterIdentity("ipfs://QmAgentProfileExample123")}
          disabled={running}
          className="mt-3 w-full rounded-xl border border-[var(--color-accent-info)]/60 bg-[var(--color-accent-info)]/10 px-4 py-2.5 text-sm font-medium text-[var(--color-accent-info)] transition hover:bg-[var(--color-accent-info)]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Register sample agent identity (metadata CID)
        </button>
      )}

      {lastResolve && (
        <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-900/10 p-3 text-xs">
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
            ? "border-[var(--color-accent-success)]/60 bg-[var(--color-accent-success)]/10 text-[var(--color-accent-success)]"
            : statusKey === "error"
              ? "border-[var(--color-accent-destructive)]/60 bg-[var(--color-accent-destructive)]/10 text-[var(--color-accent-destructive)]"
              : statusKey === "challenged"
                ? "border-amber-800/60 bg-amber-900/10 text-amber-300"
                : (statusKey === "challenging" || statusKey === "resolving")
                  ? "border-[var(--color-accent-info)]/60 bg-[var(--color-accent-info)]/10 text-[var(--color-accent-info)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
        }`}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            statusKey === "done"
              ? "bg-[var(--color-accent-success)]"
              : statusKey === "error"
                ? "bg-[var(--color-accent-destructive)]"
                : statusKey === "challenged"
                  ? "bg-amber-400"
                  : (statusKey === "challenging" || statusKey === "resolving")
                    ? "bg-[var(--color-accent-info)] pulse-ring"
                    : "bg-[var(--color-accent-secondary)] pulse-ring"
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
    <section className="fade-up card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Panel B · Watch on Base</h2>
        <Chip tone="green">on-chain</Chip>
      </div>

      {!demo ? (
        <div className="mt-6 flex h-40 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">
          No completion yet. Run the demo to self-attest on-chain.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <TxField label="attestCompletion tx" hash={demo.attestTx} chainId={contracts?.chainId} />

          {/* Real LoRA output */}
          <div className="card-inset p-4 bg-[var(--color-surface)]">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">Real LoRA summarization output</div>
              <Chip tone="blue">{demo.latencyMs}ms</Chip>
            </div>
            <div className="mono mt-1 text-xs text-[var(--color-text-secondary)]">model: {demo.modelUsed}</div>
            <div className="mt-2 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-text-primary)]">
              {demo.summary || <span className="text-[var(--color-text-secondary)]">(empty output)</span>}
            </div>
            <details className="mt-2">
              <summary className="mono cursor-pointer text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">input corpus</summary>
              <div className="mt-1 rounded-lg bg-[var(--color-surface-alt)] p-2 text-xs text-[var(--color-text-secondary)]">{demo.inputCorpus}</div>
            </details>
          </div>

          <div className="card-inset p-4 bg-[var(--color-surface)]">
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">Completion record</div>
            <div className="mono mt-2 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
              <div><span className="text-[var(--color-text-secondary)]">completionId</span> {demo.completionId}</div>
              <div><span className="text-[var(--color-text-secondary)]">agent</span> {trunc(demo.agentAddress)}</div>
              <div><span className="text-[var(--color-text-secondary)]">resultCID</span> <a href={`https://gateway.pinata.cloud/ipfs/${demo.resultCID.replace("ipfs://", "")}`} target="_blank" rel="noreferrer" className="text-[var(--color-accent-info)] hover:underline">{demo.resultCID.slice(0, 30)}…</a></div>
              <div><span className="text-[var(--color-text-secondary)]">capability</span> #{demo.capabilityId} ({demo.capability.capabilityType})</div>
              <div><span className="text-[var(--color-text-secondary)]">bond</span> {demo.capability.bond} ETH</div>
            </div>
          </div>

          <div className="card-inset p-4 bg-[var(--color-surface)]">
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">Score before → after (with decay)</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="mono text-2xl font-semibold text-[var(--color-text-secondary)]">
                {beforeCompletions === 0 && beforeDisputes === 0 ? "unrated" : beforeScore}
              </div>
              <span className="text-[var(--color-text-secondary)]">→</span>
              <div className="mono text-2xl font-semibold text-[var(--color-accent-success)]">{afterScore}</div>
              <Chip tone="green">+{afterScore - beforeScore}</Chip>
              <span className="mono ml-auto text-xs text-[var(--color-text-secondary)]">
                {demo.after.completions} completions · {demo.after.disputes} disputes
              </span>
            </div>
            <div className="mono mt-1 text-[10px] text-[var(--color-text-secondary)]">
              Raw (no decay): {beforeCompletions - beforeDisputes} → {demo.after.completions - demo.after.disputes} (decays with inactivity via lastActivity on RON)
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">Note: displayed scores from getSelfAttestScore already apply decay for &gt;30d inactivity.</div>
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
    <div className="card-inset p-3 bg-[var(--color-surface)]">
      <div className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">{label}</div>
      {hash ? (
        <a
          href={href ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="mono mt-1 block truncate text-xs text-[var(--color-accent-success)] hover:underline"
          title={hash}
        >
          {hash}
        </a>
      ) : (
        <div className="mono mt-1 text-xs text-[var(--color-text-secondary)]">—</div>
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
    <section className="fade-up card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Panel C · Agent B discovers Agent A (indexed)
        </h2>
        <div className="flex items-center gap-2">
          <Chip tone="blue">indexed on-chain</Chip>
          <Chip>min score 0</Chip>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)]">
        <div className="bg-[var(--color-surface-alt)] px-4 py-1.5 text-xs text-[var(--color-text-secondary)]">
          Discovered via on-chain indexed registry (getCapabilitiesByType — O(1) lookup)
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-alt)] text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
            <tr>
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-4 py-2.5">Capability</th>
              <th className="px-4 py-2.5">Bond</th>
              <th className="px-4 py-2.5">Score</th>
              <th className="px-4 py-2.5">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {discovery.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                  No certified capabilities yet. Run the demo to register and self-attest.
                </td>
              </tr>
            ) : (
              discovery.map((d) => (
                <tr
                  key={d.agentAddress + d.capabilityId}
                  className="cursor-pointer transition hover:bg-[var(--color-surface)]"
                  onClick={() => setExpanded(!expanded)}
                >
                  <td className="px-4 py-3">
                    <div className="mono text-[var(--color-text-primary)]">{trunc(d.agentAddress)}</div>
                    <div className="mono text-xs text-[var(--color-text-secondary)]">
                      {d.completions} completions · {d.disputes} disputes
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Chip tone="blue">{d.capabilityType}</Chip>
                      <Chip tone="green">certified</Chip>
                      {d.slashed && <Chip tone="rose">slashed</Chip>}
                    </div>
                    <div className="mono mt-1 text-xs text-[var(--color-text-secondary)]">cap #{d.capabilityId}</div>
                    {d.identityCID && <div className="mono mt-1 text-xs text-[var(--color-accent-info)] truncate">id: {d.identityCID.slice(0,20)}…</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone="amber">{d.bond} ETH</Chip>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mono text-lg text-[var(--color-accent-success)]">{d.score}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--color-accent-info)]">view evidence ↗</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {expanded && contracts && (
        <div className="fade-up mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">On-chain verification (you just did this)</div>
          <div className="mono mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
            <div><span className="text-[var(--color-text-secondary)]">ReputationOracleNetwork.getSelfAttestScore(agent)</span></div>
            <div><span className="text-[var(--color-text-secondary)]">CapabilityRegistry.getCapability(id)</span></div>
            <div><span className="text-[var(--color-text-secondary)]">chain</span> {chainLabel(contracts.chainId)}</div>
            <div><span className="text-[var(--color-text-secondary)]">RON</span> {contracts.ron}</div>
            <div><span className="text-[var(--color-text-secondary)]">Registry</span> {contracts.registry}</div>
          </div>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            You just verified this yourself. No platform vouched for Agent A.
          </p>
        </div>
      )}
    </section>
  );
}

function Footer({ contracts }: { contracts: Contracts | null }) {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-6 text-sm text-[var(--color-text-secondary)]">
      <div className="flex flex-wrap items-center gap-4">
        <span className="mono text-[var(--color-text-secondary)]">TAOP — the invisible reputation layer for the agent economy.</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {contracts && (
          <a className="hover:text-[var(--color-text-primary)]" href={`${contracts.explorerBase}/address/${contracts.ron}`} target="_blank" rel="noreferrer">
            contracts
          </a>
        )}
        <a className="hover:text-[var(--color-text-primary)]" href="/api/docs/" target="_blank" rel="noreferrer">API docs</a>
        <a className="hover:text-[var(--color-text-primary)]" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </footer>
  );
}
