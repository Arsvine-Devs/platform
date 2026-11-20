import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  agentRules: true,
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  cacheMaxMemorySize: 16 * 1024 * 1024,
  logging: { browserToTerminal: true },
  experimental: { isrFlushToDisk: false },
};

export default nextConfig;
