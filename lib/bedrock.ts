import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";

const BASE = process.env.BEDROCK_BASE_URL ?? "";
const KEY = process.env.BEDROCK_API_KEY ?? "";
export const MODEL = process.env.BEDROCK_MODEL_ID ?? "google.gemma-4-26b-a4b";

/** True when the mantle endpoint is configured; otherwise AI routes fall back to canned output. */
export const aiEnabled = Boolean(BASE && KEY);

// NOTE: base URL must end in /openai/v1 — plain /v1 returns a misleading
// "Berm is not enabled" 401, and /anthropic is Claude-only. See demo/README.md.
function client() {
  return new OpenAI({
    baseURL: BASE,
    apiKey: KEY,
    defaultHeaders: { "OpenAI-Project": "default" },
  });
}

/** Langfuse trace context for a single model call (see lib/langfuse.ts). */
export type TraceMeta = {
  name?: string; // generation/observation name, e.g. "grade-submission"
  traceName?: string; // trace name; defaults to `name`. e.g. "grade-run" for a whole batch
  userId?: string; // the teacher
  sessionId?: string; // groups related generations (e.g. one grading session)
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type ModelCall = {
  system?: string;
  text: string;
  images?: Buffer[]; // PNG page images (Gemma has no native PDF input)
  maxTokens?: number;
  temperature?: number;
  trace?: TraceMeta; // observability context; no-ops when Langfuse is disabled
};

/**
 * Wrap the OpenAI client so the call is traced in Langfuse. When credentials
 * are absent the OTel provider is a no-op, so this stays a zero-cost passthrough.
 */
function traced(call: ModelCall) {
  const name = call.trace?.name ?? "bedrock-generation";
  return observeOpenAI(client(), {
    generationName: name,
    traceName: call.trace?.traceName ?? name, // names the trace, not just the observation
    userId: call.trace?.userId,
    sessionId: call.trace?.sessionId,
    tags: call.trace?.tags,
    generationMetadata: { model: MODEL, ...call.trace?.metadata },
  });
}

function userContent({ text, images = [] }: ModelCall): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  return [
    { type: "text", text },
    ...images.map(
      (img): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img.toString("base64")}` },
      })
    ),
  ];
}

function messages(call: ModelCall): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    ...(call.system ? [{ role: "system" as const, content: call.system }] : []),
    { role: "user" as const, content: userContent(call) },
  ];
}

export async function callModel(call: ModelCall): Promise<string> {
  const res = await traced(call).chat.completions.create({
    model: MODEL,
    max_tokens: call.maxTokens ?? 2048,
    temperature: call.temperature ?? 0,
    messages: messages(call),
  });
  return res.choices[0]?.message?.content ?? "";
}

export async function* streamModel(call: ModelCall): AsyncGenerator<string> {
  const stream = await traced(call).chat.completions.create({
    model: MODEL,
    max_tokens: call.maxTokens ?? 2048,
    temperature: call.temperature ?? 0.3,
    stream: true,
    stream_options: { include_usage: true }, // emit token usage so Langfuse can cost it
    messages: messages(call),
  });
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Tolerant JSON extraction — strips code fences, grabs the first {...} block. */
export function extractJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      // common model slip: trailing commas
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}
