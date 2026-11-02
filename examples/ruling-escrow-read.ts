import { JsonRpcProvider } from "ethers";
import { RulingOracleClient } from "@taopp/sdk";

// Replace with the deployment artifact's rulingOracle address.
const oracle = new RulingOracleClient("0x...", new JsonRpcProvider(process.env.RPC_URL));

export async function settleOnlyAfterFinal(caseId: string) {
  const { ruling, status, evidenceHash } = await oracle.outcome(caseId);
  if (status !== 3 && status !== 4) throw new Error("ruling is not final");
  if (ruling !== 1 && ruling !== 2) throw new Error("no ruling");
  return { payProvider: ruling === 1, refundPayer: ruling === 2, evidenceHash };
}
