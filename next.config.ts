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
  experimental: {
    // Default for dynamic routes is 0, which throws away the client router cache
    // immediately — every back-navigation refetched from the server. Holding the
    // RSC payload briefly makes back/forward between class pages instant and
    // makes <Link> prefetch worth something on these force-dynamic routes.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
