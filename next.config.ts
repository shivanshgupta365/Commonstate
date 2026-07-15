import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
