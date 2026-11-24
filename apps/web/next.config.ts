import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// Next only reads .env files from apps/web. Also take NEXT_PUBLIC_* values from the
// repository-root .env (the one the README tells you to create). Values already set
// in the environment, or in apps/web/.env*, win. Docker builds pass build args instead.
const rootEnv = path.resolve(__dirname, "..", "..", ".env");
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (key.startsWith("NEXT_PUBLIC_") && process.env[key] === undefined) process.env[key] = value;
  }
}

// Tailwind is processed through PostCSS (postcss.config.mjs), which works for
// both webpack builds and Turbopack dev.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
