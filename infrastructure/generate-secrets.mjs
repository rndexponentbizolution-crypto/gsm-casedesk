// Fills every empty secret in the root .env with a random value (creating .env from
// .env.example first if needed) and keeps the URLs that embed them in step.
// Existing values are never changed, so it is safe to run again.
//
//   node infrastructure/generate-secrets.mjs
//
// The values are written to .env only; nothing is printed.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (!existsSync(envPath)) copyFileSync(resolve(root, '.env.example'), envPath);

const SECRETS = ['POSTGRES_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'KC_BOOTSTRAP_ADMIN_PASSWORD', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'S3_SECRET_KEY'];
// URL-safe, so a value can sit inside DATABASE_URL without escaping.
const secret = () => randomBytes(24).toString('base64url');

let text = readFileSync(envPath, 'utf8');
const value = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
const set = (key, next) => {
  const line = `${key}=${next}`;
  text = new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${text.replace(/\n?$/, '\n')}${line}\n`;
};

const generated = [];
for (const key of SECRETS) {
  const current = value(key);
  if (!current || current === 'change-me' || current.startsWith('replace-')) {
    set(key, secret());
    generated.push(key);
  }
}
// The app reaches the Compose database with the generated password.
const port = value('POSTGRES_HOST_PORT') || '5433';
const databaseUrl = `postgresql://casedesk:${value('POSTGRES_PASSWORD')}@localhost:${port}/casedesk`;
if (value('DATABASE_URL') !== databaseUrl) set('DATABASE_URL', databaseUrl);

writeFileSync(envPath, text);
console.log(generated.length ? `Generated ${generated.join(', ')} in .env.` : 'All secrets were already set; nothing changed.');
