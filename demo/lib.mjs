// Shared helpers for the GradeMate verification scripts.
// Auto-detects the Bedrock "mantle" dialect from the base URL:
//   .../anthropic  -> Anthropic Messages format (@anthropic-ai/sdk)
//   .../v1         -> OpenAI Chat Completions format (openai)
// Both authenticate with the Bedrock API key as a Bearer token.

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.BEDROCK_BASE_URL;
const KEY = process.env.BEDROCK_API_KEY;
export const MODEL = process.env.BEDROCK_MODEL_ID;
export const DIALECT = (BASE || "").includes("/anthropic") ? "anthropic" : "openai";

function requireBedrockEnv() {
  const missing = [];
  if (!BASE) missing.push("BEDROCK_BASE_URL");
  if (!KEY) missing.push("BEDROCK_API_KEY");
  if (!MODEL) missing.push("BEDROCK_MODEL_ID");
  if (missing.length) {
    throw new Error(`Missing in ../.env: ${missing.join(", ")}`);
  }
}

// Build a content array in whichever dialect is configured.
function buildContent(text, imagesB64) {
  if (DIALECT === "anthropic") {
    return [
      { type: "text", text },
      ...imagesB64.map((data) => ({
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      })),
    ];
  }
  return [
    { type: "text", text },
    ...imagesB64.map((data) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${data}` },
    })),
  ];
}

// One unified call. Returns { text, usage, dialect }.
export async function callModel({ text, images = [], maxTokens = 1024, temperature = 0 }) {
  requireBedrockEnv();
  const content = buildContent(text, images);

  if (DIALECT === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ baseURL: BASE, authToken: KEY });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content }],
    });
    const out = (msg.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { text: out, usage: msg.usage, dialect: DIALECT };
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: BASE,
    apiKey: KEY,
    defaultHeaders: { "OpenAI-Project": "default" },
  });
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content }],
  });
  return { text: resp.choices?.[0]?.message?.content ?? "", usage: resp.usage, dialect: DIALECT };
}

// Low-level diagnostic: hit the endpoint with plain fetch and dump the raw
// status + body. Useful when the SDK call fails so we can see the real contract.
export async function rawProbe() {
  const url =
    DIALECT === "anthropic" ? `${BASE}/v1/messages` : `${BASE}/chat/completions`;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${KEY}`,
  };
  let body;
  if (DIALECT === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    };
  } else {
    body = { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "ping" }] };
  }
  console.log(`\n[rawProbe] POST ${url}`);
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const textBody = await res.text();
  console.log(`[rawProbe] status ${res.status} ${res.statusText}`);
  console.log(`[rawProbe] body: ${textBody.slice(0, 800)}`);
}

// Tolerant JSON extraction from a model response (handles ```json fences etc).
export function extractJson(raw) {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Create a mock "student submission" PDF (typed answers, one deliberately wrong)
// so the grading test has something meaningful to score.
export async function ensureSamplePdf(pdfPath, { force = false } = {}) {
  if (!force) {
    try {
      await fs.access(pdfPath);
      return pdfPath;
    } catch {}
  }
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ margin: 56 });
  const stream = createWriteStream(pdfPath);
  doc.pipe(stream);
  doc.fontSize(18).text("Algebra Quiz — Student Submission", { underline: true });
  doc.moveDown(0.5).fontSize(12).fillColor("#444").text("Name: Test Student");
  doc.moveDown(1).fillColor("#000");
  doc.fontSize(13).text("Q1. Solve 2x + 3 = 11.");
  doc.fontSize(12).fillColor("#1a4").text("Answer: 2x = 8, so x = 4.   [correct]");
  doc.moveDown(1).fillColor("#000");
  doc.fontSize(13).text("Q2. Evaluate the integral of x dx from 0 to 3.");
  doc.fontSize(12).fillColor("#a11").text("Answer: = 3.   [wrong — should be 9/2 = 4.5]");
  doc.end();
  await new Promise((res, rej) => {
    stream.on("finish", res);
    stream.on("error", rej);
  });
  return pdfPath;
}
