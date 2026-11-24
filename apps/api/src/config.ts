/**
 * `simulation` (default, SIMULATION_ENABLED unset or true): outbound messages are
 * recorded but never leave CaseDesk, and nothing comes in (there is no simulator).
 * `live`: outbound messages go to Meta's WhatsApp Cloud API through the outbox and
 * the signed Meta webhook is the only way in.
 */
export type MessagingMode = 'simulation' | 'live';

export function messagingMode(
  env: NodeJS.ProcessEnv = process.env,
): MessagingMode {
  return env.SIMULATION_ENABLED?.trim().toLowerCase() === 'false'
    ? 'live'
    : 'simulation';
}

const LIVE_REQUIRED = [
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_ACCESS_TOKEN',
  'META_PHONE_NUMBER_ID',
  'S3_BUCKET',
] as const;

/**
 * Checks the environment once at startup. Throws on settings that would make the
 * deployment unsafe or broken; returns warnings for things worth fixing.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: MessagingMode;
  warnings: string[];
} {
  const problems: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';

  // Demo sign-in has been removed: Keycloak is the only way in, whatever this says.
  if (env.AUTH_MODE && env.AUTH_MODE.trim().toLowerCase() !== 'keycloak')
    warnings.push(
      `AUTH_MODE=${env.AUTH_MODE} is ignored: demo sign-in no longer exists and every request needs a Keycloak token. Remove the setting.`,
    );
  if (!env.KEYCLOAK_ADMIN_CLIENT_SECRET?.trim())
    warnings.push(
      'KEYCLOAK_ADMIN_CLIENT_SECRET is not set: staff accounts cannot be created or reset from CaseDesk.',
    );

  const mode = messagingMode(env);
  if (mode === 'live') {
    const missing = LIVE_REQUIRED.filter((key) => !env[key]?.trim());
    if (missing.length)
      problems.push(
        `SIMULATION_ENABLED=false (live WhatsApp) requires ${missing.join(', ')}.`,
      );
  }

  if (production) {
    if (!env.WEB_ORIGIN?.trim())
      warnings.push(
        'WEB_ORIGIN is not set; CORS only allows http://localhost:3000.',
      );
    if (!env.CLAMAV_HOST?.trim() && mode === 'live')
      warnings.push(
        'CLAMAV_HOST is not set; attachments are stored unscanned (scanStatus NOT_SCANNED).',
      );
    if (env.S3_ACCESS_KEY === 'casedesk' || env.S3_SECRET_KEY === 'change-me')
      problems.push(
        'S3_ACCESS_KEY / S3_SECRET_KEY still use the development defaults.',
      );
  }

  if (problems.length)
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return { mode, warnings };
}
