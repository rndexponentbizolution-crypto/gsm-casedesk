import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/**
 * Manages staff sign-in accounts in Keycloak through its admin REST API, using the
 * realm's `gsm-casedesk-admin` client (a service account limited to managing the
 * realm's users). CaseDesk never sees or stores anyone's chosen password: it only
 * creates one-time temporary passwords that Keycloak forces the person to change,
 * and Keycloak makes them set up an authenticator app at first sign-in.
 */

// No look-alike characters (0/O, 1/l/I), so it can be read out or typed from a note.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SYMBOLS = '!@#$%*?';

/** A one-time password that meets the realm policy (12+ characters). */
export function temporaryPassword(length = 16) {
  const chars = Array.from({ length: length - 2 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  chars.push(String(randomInt(2, 10)), SYMBOLS[randomInt(SYMBOLS.length)]);
  // Shuffle so the digit and symbol are not always at the end.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface KeycloakUserInput {
  email: string;
  firstName: string;
  lastName: string;
}

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
};
export const keycloakName = (name: string, email: string): KeycloakUserInput => ({
  email,
  ...splitName(name),
});

@Injectable()
export class KeycloakAdmin {
  private token?: { value: string; expires: number };

  private config() {
    const base = (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
    const realm = process.env.KEYCLOAK_REALM ?? 'gsm-casedesk';
    return {
      base,
      realm,
      clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'gsm-casedesk-admin',
      secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '',
    };
  }

  get configured() {
    return Boolean(this.config().secret);
  }

  private async accessToken() {
    if (this.token && this.token.expires > Date.now() + 10_000) return this.token.value;
    const { base, realm, clientId, secret } = this.config();
    if (!secret)
      throw new ServiceUnavailableException(
        'Account management is not configured (KEYCLOAK_ADMIN_CLIENT_SECRET is missing).',
      );
    const response = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!response?.ok)
      throw new ServiceUnavailableException(
        `Keycloak refused the account-management client (${response?.status ?? 'unreachable'}).`,
      );
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async call(method: string, path: string, body?: unknown) {
    const { base, realm } = this.config();
    const response = await fetch(`${base}/admin/realms/${realm}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let detail = '';
      try {
        const error = (await response.json()) as { errorMessage?: string; error?: string };
        detail = error.errorMessage ?? error.error ?? '';
      } catch {
        /* no JSON body */
      }
      throw new KeycloakError(response.status, detail || `Keycloak ${method} ${path} failed (${response.status})`);
    }
    return response;
  }

  /** Creates an enabled user with a temporary password; returns their Keycloak id. */
  async createUser(input: KeycloakUserInput, password: string) {
    const response = await this.call('POST', '/users', {
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      credentials: [{ type: 'password', value: password, temporary: true }],
    });
    const id = response.headers.get('location')?.split('/').at(-1);
    if (!id) throw new KeycloakError(502, 'Keycloak created the user but returned no id');
    return id;
  }

  async updateUser(id: string, changes: Partial<KeycloakUserInput> & { enabled?: boolean }) {
    const user: Record<string, unknown> = { ...changes };
    if (changes.email) user.username = changes.email;
    await this.call('PUT', `/users/${id}`, user);
  }

  /** Ends every session the user has (used when deactivating). */
  async logout(id: string) {
    await this.call('POST', `/users/${id}/logout`);
  }

  /** Sets a new temporary password the user must change at next sign-in. */
  async resetPassword(id: string, password: string) {
    await this.call('PUT', `/users/${id}/reset-password`, { type: 'password', value: password, temporary: true });
  }

  async deleteUser(id: string) {
    await this.call('DELETE', `/users/${id}`);
  }

  async findByEmail(email: string): Promise<{ id: string } | null> {
    const response = await this.call('GET', `/users?email=${encodeURIComponent(email)}&exact=true`);
    const users = (await response.json()) as Array<{ id: string }>;
    return users[0] ?? null;
  }
}

export class KeycloakError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
