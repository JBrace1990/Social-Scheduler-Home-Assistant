import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The local Windows hosts entry maps this browser origin to 127.0.0.1.
  allowedDevOrigins: ["sm.shopmanyworlds.com"],
  // better-sqlite3 is a native module — keep it external to the server bundle so
  // Next doesn't try to bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
