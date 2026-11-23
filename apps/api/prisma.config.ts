import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { loadEnv } from './src/load-env';

// With a config file Prisma no longer reads .env itself, so load the same files the
// API does (root .env included).
loadEnv(__dirname);

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
