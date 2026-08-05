import { LangfuseSpanProcessor } from "@langfuse/otel";

/** Tracing is active only when Langfuse credentials are present (reads LANGFUSE_* env). */
export const langfuseEnabled = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
);

// Submission/brief page images are sent to Gemma as base64 data URIs. We don't
// want multi-MB student scans shipped to Langfuse (payload bloat + PII), so we
// strip them from the traced input/output and leave a short placeholder.
const DATA_URI = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g;

function mask({ data }: { data: unknown }): unknown {
  try {
    if (typeof data === "string") return data.replace(DATA_URI, "data:image/*;base64,[omitted]");
    const cleaned = JSON.stringify(data).replace(DATA_URI, "data:image/*;base64,[omitted]");
    return JSON.parse(cleaned);
  } catch {
    return data;
  }
}

/**
 * One span processor shared between the OpenTelemetry NodeSDK (started in
 * `instrumentation.ts`) and the route handlers that flush it. Kept in a single
 * module so both sides reference the same instance via the Node module cache —
 * flushing a different instance than the one registered would send nothing.
 *
 * `immediate` export suits our short-lived, serverless-style route handlers;
 * media upload is off since we mask image bytes out of the payload anyway.
 */
export const langfuseSpanProcessor = langfuseEnabled
  ? new LangfuseSpanProcessor({
      mask,
      mediaUploadEnabled: false,
      exportMode: "immediate",
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
    })
  : null;

/**
 * Flush buffered spans. Call from `after()` in a route handler so a request
 * (including our streaming ones) doesn't return before its traces are sent.
 * No-ops when tracing is disabled; never throws into the request.
 */
export async function flushLangfuse(): Promise<void> {
  try {
    await langfuseSpanProcessor?.forceFlush();
  } catch {
    // telemetry must never break the actual request
  }
}
