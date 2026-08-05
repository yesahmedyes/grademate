// Test 3: the real grading primitive end-to-end.
// PDF -> page images -> model (vision) -> structured JSON grade.
// This is exactly the loop GradeMate will run per student.
import path from "node:path";
import { pdf } from "pdf-to-img";
import { here, ensureSamplePdf, callModel, extractJson, DIALECT, MODEL } from "./lib.mjs";

console.log(`Dialect: ${DIALECT}   Model: ${MODEL}\n`);

// 1) PDF -> base64 page images
const src = await ensureSamplePdf(path.join(here, "sample.pdf"));
const images = [];
for await (const page of await pdf(src, { scale: 2 })) {
  images.push(page.toString("base64"));
}
console.log(`✓ rendered ${images.length} page image(s) from ${path.basename(src)}`);

// 2) Grading instructions (marking scheme + required output shape)
const markingScheme = `
Q1 (5 pts): Solve 2x + 3 = 11. Correct answer x = 4. Award full marks for x = 4 with working.
Q2 (5 pts): Integral of x dx from 0 to 3 equals 9/2 = 4.5. Award full marks only for 4.5 with working.
`.trim();

const prompt = `You are a teaching assistant grading a student's quiz shown in the page image(s).

MARKING SCHEME:
${markingScheme}

Grade strictly against the scheme. Respond with JSON ONLY (no prose, no markdown) in this shape:
{"total": <number>, "max": 10, "items": [{"q": "Q1", "score": <number>, "max": 5, "reason": "<short>"}, {"q": "Q2", "score": <number>, "max": 5, "reason": "<short>"}], "feedback": "<one or two sentences>"}`;

// 3) Call the model with the page images
console.log("→ sending to model for grading...\n");
const { text, usage } = await callModel({ text: prompt, images, maxTokens: 800 });

console.log("--- raw model output ---");
console.log(text);

const grade = extractJson(text);
console.log("\n--- parsed grade ---");
if (grade) {
  console.dir(grade, { depth: null });
  console.log(
    `\nHealth check: model should give Q1 ~5/5 and dock Q2 (answer was wrong). ` +
      `Got total ${grade.total}/${grade.max ?? 10}.`
  );
} else {
  console.log("⚠ Could not parse JSON from the response. The model may not follow the format; we'll use tool/structured output in the app.");
}
console.log("\nusage:", usage);
