import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// `PAGES_BASE` lets the GitHub Pages workflow build for /TAOP-protocol/.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: process.env.PAGES_BASE ?? "/",
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  plugins: [
    {
      // Vite's public-dir copy skips dot-directories, so emit the RFC 9116
      // file explicitly to guarantee `/.well-known/security.txt` ships.
      name: "emit-well-known-security-txt",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: ".well-known/security.txt",
          source: readFileSync(new URL("./public/.well-known/security.txt", import.meta.url), "utf8"),
        });
      },
    },
  ],
});
