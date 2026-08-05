/**
 * Next.js runs `register()` once at server startup. We start the OpenTelemetry
 * Node SDK with Langfuse's span processor so every wrapped OpenAI call
 * (see lib/bedrock.ts) is traced. Imports are dynamic + node-runtime-guarded so
 * the OTel packages never load in the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { langfuseSpanProcessor } = await import("@/lib/langfuse");
  if (!langfuseSpanProcessor) return; // no LANGFUSE_* creds → tracing disabled

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();
}
