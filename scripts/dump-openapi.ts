/**
 * Dump the generated OpenAPI spec to a file for linting/diffing:
 *
 *   npx tsx scripts/dump-openapi.ts /tmp/taop-openapi.json
 *
 * The spec lives in code (`packages/backend/src/openapi.ts`) and is served at
 * /api/openapi.json; this makes it consumable by Spectral and other tools.
 */
import { writeFileSync } from "node:fs";

import { openApiSpec } from "../packages/backend/src/openapi.js";

const out = process.argv[2] ?? "openapi.json";
writeFileSync(out, `${JSON.stringify(openApiSpec, null, 2)}\n`);
console.log(`wrote ${out}`);
