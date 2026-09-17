import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Copy an existing file to `<name>.bak-<timestamp>` (chmod 600) before modifying it. */
export function backupFile(p: string): void {
  if (!fs.existsSync(p)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${p}.bak-${stamp}`;
  fs.copyFileSync(p, bak);
  try {
    fs.chmodSync(bak, 0o600);
  } catch {
    /* best effort */
  }
  console.log("Backed up", p, "to", bak);
}

/** Refuse to write secret material into a path git would track. */
export function assertNotTracked(p: string, label: string): void {
  let root: string;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    console.warn(`! Not a git repo — cannot verify ${label} is ignored (${p}). Proceed with care.`);
    return;
  }
  const rel = path.relative(root, p);
  const insideRepo = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!insideRepo) return; // outside the repo — cannot be committed

  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "ignore" });
  } catch (e) {
    if ((e as { status?: number }).status === 1) {
      console.error(`\n❌ REFUSING TO WRITE ${label}: ${p} is inside the repo but NOT gitignored.`);
      console.error("   Add it to .gitignore — key material must never be committed.\n");
      process.exit(1);
    }
    console.warn(`! Could not verify .gitignore for ${p}.`);
  }
}

/** Refuse to write a JSON/text artifact that contains a key-shaped value. */
export function assertNoKeyMaterial(text: string, label: string): void {
  const m = text.match(/0x[0-9a-fA-F]{64}/);
  if (m) {
    console.error(`\n❌ REFUSING TO WRITE ${label}: contains a key-shaped value (${m[0].slice(0, 10)}…).`);
    console.error("   Private keys belong only in .env — never in a publishable artifact.\n");
    process.exit(1);
  }
}

/** Read a KEY=value from a dotenv-style file (last occurrence wins). */
export function readEnvVar(file: string, key: string): string {
  try {
    let value = "";
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim().startsWith(`${key}=`)) value = line.split("=").slice(1).join("=").trim();
    }
    return value;
  } catch {
    return "";
  }
}
