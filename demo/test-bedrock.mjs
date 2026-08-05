// Test 1: connectivity + model + dialect.
// Proves the Bedrock "mantle" endpoint, API key, and BEDROCK_MODEL_ID work.
import { callModel, rawProbe, DIALECT, MODEL } from "./lib.mjs";

console.log(`Dialect: ${DIALECT}   Model: ${MODEL}`);

try {
  const { text, usage } = await callModel({
    text: "Reply with exactly this and nothing else: GradeMate connection OK",
    maxTokens: 32,
  });
  console.log("\n✓ Model replied:", JSON.stringify(text));
  console.log("  usage:", usage);
} catch (err) {
  console.error("\n✗ SDK call failed:", err?.status ?? "", err?.message ?? err);
  console.error("Running a raw HTTP probe to reveal the actual endpoint contract...");
  try {
    await rawProbe();
  } catch (e2) {
    console.error("[rawProbe] also failed:", e2?.message ?? e2);
  }
  process.exitCode = 1;
}
