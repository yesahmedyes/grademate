import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pdf-to-img",
    "sharp",
    "googleapis",
    // OTel + Langfuse rely on runtime module patching — keep them unbundled.
    "@opentelemetry/sdk-node",
    "@langfuse/otel",
    "@langfuse/openai",
    "@langfuse/tracing",
  ],
};

export default nextConfig;
