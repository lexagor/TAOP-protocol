import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// `PAGES_BASE` lets the GitHub Pages workflow build for /TAOP-protocol/.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: process.env.PAGES_BASE ?? "/",
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
