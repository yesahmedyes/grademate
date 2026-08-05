// Test 2: PDF -> per-page PNG conversion (no API keys needed).
// Proves the pdf-to-img tooling works locally on this machine.
import fs from "node:fs/promises";
import path from "node:path";
import { pdf } from "pdf-to-img";
import { here, ensureSamplePdf } from "./lib.mjs";

const src = await ensureSamplePdf(path.join(here, "sample.pdf"));
const outDir = path.join(here, "out");
await fs.mkdir(outDir, { recursive: true });

const doc = await pdf(src, { scale: 2 }); // scale ~ resolution
let n = 0;
for await (const page of doc) {
  n++;
  const p = path.join(outDir, `page-${n}.png`);
  await fs.writeFile(p, page);
  console.log(`✓ ${p}  (${(page.length / 1024).toFixed(0)} KB)`);
}
console.log(`\nConverted ${n} page(s) from ${path.basename(src)} into ${outDir}/`);
