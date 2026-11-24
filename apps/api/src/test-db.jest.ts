/**
 * Jest global setup: database tests run against their OWN database, never the one
 * the app uses, because they wipe tickets and audit events between tests.
 *
 * TEST_DATABASE_URL if set, otherwise DATABASE_URL with "_test" appended to the
 * database name. It must be on a local/CI host and its name must end in "_test".
 * The database is created if missing and migrated before the tests run.
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv } from './load-env';

export const SAFE_HOSTS = ['localhost', '127.0.0.1', 'postgres'];

export function testDatabaseUrl(env = process.env) {
  if (env.TEST_DATABASE_URL) return new URL(env.TEST_DATABASE_URL);
  if (!env.DATABASE_URL) return null;
  const url = new URL(env.DATABASE_URL);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url;
}

export default async function globalSetup() {
  loadEnv(resolve(__dirname, '..'));
  const url = testDatabaseUrl();
  if (!url) {
    // No database configured: database suites refuse to run on their own.
    return;
  }
  const name = url.pathname.replace(/^\//, '');
  if (!SAFE_HOSTS.includes(url.hostname) || !name.endsWith('_test'))
    throw new Error(
      `Refusing to use "${url.hostname}/${name}" for tests: it must be a local/CI host and a database named *_test.`,
    );

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const prisma = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const exists = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!exists.length) await prisma.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'ignore',
  });
  process.env.DATABASE_URL = url.toString();
  process.env.TEST_DATABASE_READY = '1';
}
