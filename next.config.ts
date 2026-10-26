import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public client-view demo at /sample (no sign-in needed).
  async rewrites() {
    return [{ source: "/sample", destination: "/sample.html" }];
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
