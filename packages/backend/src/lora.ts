import "dotenv/config";

/**
 * LoRA summarization inference via Replicate. For the pilot we use
 * meta/llama-3.2-1b-instruct (small, fast, ~$0.001/call) with a
 * summarization system prompt. The "LoRA adapter" framing is documented in
 * the model card (pinned to IPFS at registration time) — the capability is
 * "summarization with a specific prompt/prompt-template that acts as a
 * soft-LoRA configuration."
 *
 * In v2 this can be swapped for a real PEFT LoRA adapter hosted on Replicate
 * or HuggingFace; the contract + evidence layer doesn't change.
 */
const REPLICATE_API = "https://api.replicate.com/v1";
const TOKEN = process.env.REPLICATE_API_TOKEN;

const SUMMARIZATION_MODEL = "openai/gpt-4.1-nano";
const SUMMARIZATION_SYSTEM_PROMPT =
  "You are a summarization agent. Summarize the user's text in 2-3 sentences. Be concise and factual. Do not add information not present in the source.";

export interface SummarizationResult {
  summary: string;
  modelUsed: string;
  inputText: string;
  latencyMs: number;
}

/** Run a summarization task via Replicate. Falls back to a local
 *  extractive summarizer if Replicate is unavailable (no billing, model
 *  not found, etc.) so the pilot loop always works. The evidence JSON
 *  records which path was used. */
export async function summarize(inputText: string): Promise<SummarizationResult> {
  if (!TOKEN) {
    return fallbackSummarize(inputText, "no REPLICATE_API_TOKEN");
  }
  const start = Date.now();

  try {
    const createBody = JSON.stringify({
      input: {
        prompt: inputText,
        system_prompt: SUMMARIZATION_SYSTEM_PROMPT,
        max_tokens: 150,
        temperature: 0.3,
      },
    });

    const createRes = await fetch(`${REPLICATE_API}/models/${SUMMARIZATION_MODEL}/predictions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        Prefer: "wait",
      },
      body: createBody,
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Replicate ${createRes.status}: ${errText.slice(0, 100)}`);
    }

    const prediction = (await createRes.json()) as {
      id: string;
      status: string;
      output: string | string[] | null;
      error: string | null;
    };

    let result = prediction;
    let polls = 0;
    while (result.status === "starting" || result.status === "processing") {
      if (polls++ > 60) throw new Error("Replicate prediction timed out");
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      result = (await pollRes.json()) as typeof prediction;
    }

    if (result.status === "failed" || result.error) {
      throw new Error(`Replicate prediction failed: ${result.error ?? result.status}`);
    }

    const output = Array.isArray(result.output) ? result.output.join("") : result.output ?? "";
    return {
      summary: output.trim(),
      modelUsed: SUMMARIZATION_MODEL,
      inputText,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    console.warn("Replicate inference failed, falling back to local summarizer:", (e as Error).message);
    return fallbackSummarize(inputText, (e as Error).message);
  }
}

/** A simple extractive fallback: takes the first 2 sentences of the input. */
function fallbackSummarize(inputText: string, reason: string): SummarizationResult {
  const sentences = inputText.split(/(?<=[.!?])\s+/);
  const summary = sentences.slice(0, 2).join(" ");
  return {
    summary: summary || inputText.slice(0, 200),
    modelUsed: `fallback-extractive (replicate unavailable: ${reason.slice(0, 60)})`,
    inputText,
    latencyMs: 1,
  };
}

/** A fixed demo corpus for the "Run the live demo" button. */
export const DEMO_CORPORA = [
  "The Trustless Agent Orchestration Protocol introduces a decentralized reputation layer for AI agents. By recording verifiable on-chain attestations of agent behavior, TAOP enables trustless agent-to-agent collaboration without relying on a centralized platform. The protocol combines a Credit Bureau for reputation with a capability registry for LoRA models and other AI skills.",
  "Base is an Ethereum Layer 2 built by Coinbase using the Optimism Stack. It offers low transaction fees, fast finality, and EVM compatibility, making it suitable for applications that require frequent on-chain interactions such as reputation updates and micro-attestations.",
  "LoRA (Low-Rank Adaptation) is a parameter-efficient fine-tuning technique that trains a small set of additional weights on top of a frozen base model. This allows specialized AI capabilities — like summarization, classification, or code review — to be packaged as lightweight adapters that can be registered, bonded, and verified on-chain.",
  "Self-attestation with public challenge is a trustless reputation model where agents log their own completions on-chain and anyone can post a bond to flag fraud. If the challenge is upheld, the agent's score decreases and the challenger is refunded. If rejected, the challenger forfeits the bond. No trusted validator set is required.",
];
