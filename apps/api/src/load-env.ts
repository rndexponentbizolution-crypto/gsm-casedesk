import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Loads `.env` files for local runs. Real environment variables always win, then
 * `apps/api/.env`, then the repository-root `.env` (the one the README tells you to
 * create). Missing files are skipped, so containers rely on their environment alone.
 *
 * This file sits one level below `apps/api` both as source (`src/`) and when compiled
 * (`dist/`), so the paths below hold in both cases.
 */
export function loadEnv(apiDir = resolve(__dirname, '..')): void {
  for (const file of [
    resolve(apiDir, '.env'),
    resolve(apiDir, '..', '..', '.env'),
  ]) {
    if (!existsSync(file)) continue;
    const values = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
