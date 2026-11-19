import type { NextConfig } from "next";

// Tailwind is processed through PostCSS (postcss.config.mjs), which works for
// both webpack builds and Turbopack dev.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
