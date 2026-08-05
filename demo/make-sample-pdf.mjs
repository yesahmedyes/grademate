// Generates demo/sample.pdf (a mock student submission) used by the other tests.
import path from "node:path";
import { here, ensureSamplePdf } from "./lib.mjs";

const out = path.join(here, "sample.pdf");
await ensureSamplePdf(out, { force: true });
console.log("✓ wrote", out);
