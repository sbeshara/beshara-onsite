import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public client-view demo at /sample (no sign-in needed).
  async rewrites() {
    return [{ source: "/sample", destination: "/sample.html" }];
  },
  // The report PDF reads its fonts and logo from disk.
  outputFileTracingIncludes: {
    "/studio/**": ["./assets/report/**"],
    "/api/reports/**": ["./assets/report/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
