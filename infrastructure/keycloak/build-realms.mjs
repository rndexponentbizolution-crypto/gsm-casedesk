// Writes both Keycloak realm files from one definition, so local development and
// production have the same clients and security settings:
//   infrastructure/keycloak/gsm-casedesk-realm.json            (docker compose)
//   infrastructure/keycloak-production/gsm-casedesk-realm.json (production template)
// Run after changing it: node infrastructure/keycloak/build-realms.mjs
//
// Neither file contains a person's account or any secret. ${...} placeholders are
// filled from the environment by Keycloak at import time.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function realm({ webUrl, sslRequired }) {
  return {
    realm: 'gsm-casedesk',
    enabled: true,
    displayName: 'GSM CaseDesk',
    sslRequired,
    registrationAllowed: false,
    resetPasswordAllowed: false, // no email server: administrators reset passwords in CaseDesk
    editUsernameAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    rememberMe: false,
    // Lock an account for a growing interval after repeated failures.
    bruteForceProtected: true,
    permanentLockout: false,
    failureFactor: 5,
    waitIncrementSeconds: 60,
    maxFailureWaitSeconds: 900,
    maxDeltaTimeSeconds: 43200,
    passwordPolicy: 'length(12) and notUsername and notEmail and passwordHistory(5)',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    // Everyone sets up an authenticator app at first sign-in.
    otpPolicyType: 'totp',
    otpPolicyAlgorithm: 'HmacSHA1',
    otpPolicyDigits: 6,
    otpPolicyPeriod: 30,
    requiredActions: [
      { alias: 'CONFIGURE_TOTP', name: 'Configure OTP', providerId: 'CONFIGURE_TOTP', enabled: true, defaultAction: true, priority: 10, config: {} },
      { alias: 'UPDATE_PASSWORD', name: 'Update Password', providerId: 'UPDATE_PASSWORD', enabled: true, defaultAction: false, priority: 30, config: {} },
      { alias: 'UPDATE_PROFILE', name: 'Update Profile', providerId: 'UPDATE_PROFILE', enabled: true, defaultAction: false, priority: 40, config: {} },
      { alias: 'VERIFY_EMAIL', name: 'Verify Email', providerId: 'VERIFY_EMAIL', enabled: true, defaultAction: false, priority: 50, config: {} },
    ],
    // Sign-in and admin events, kept 90 days.
    eventsEnabled: true,
    eventsExpiration: 7776000,
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: true,
    clients: [
      {
        clientId: 'gsm-casedesk-api',
        name: 'GSM CaseDesk API',
        enabled: true,
        bearerOnly: true,
        publicClient: false,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false,
      },
      {
        clientId: 'gsm-casedesk-web',
        name: 'GSM CaseDesk web app',
        enabled: true,
        publicClient: true,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        redirectUris: [`${webUrl}/*`],
        webOrigins: [webUrl],
        attributes: {
          'pkce.code.challenge.method': 'S256',
          'post.logout.redirect.uris': `${webUrl}/*`,
        },
        protocolMappers: [
          {
            name: 'casedesk-api-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.client.audience': 'gsm-casedesk-api',
              'id.token.claim': 'false',
              'access.token.claim': 'true',
            },
          },
        ],
      },
      {
        // CaseDesk's account management: creates staff sign-ins, resets passwords,
        // disables leavers. Its service account can manage users and nothing else.
        clientId: 'gsm-casedesk-admin',
        name: 'GSM CaseDesk account management',
        enabled: true,
        publicClient: false,
        bearerOnly: false,
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        clientAuthenticatorType: 'client-secret',
        secret: '${KEYCLOAK_ADMIN_CLIENT_SECRET}',
      },
    ],
    users: [
      {
        username: 'service-account-gsm-casedesk-admin',
        enabled: true,
        serviceAccountClientId: 'gsm-casedesk-admin',
        clientRoles: { 'realm-management': ['manage-users', 'view-users', 'query-users'] },
      },
    ],
  };
}

const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log('wrote', path);
};

// Local: plain HTTP is allowed on localhost only ("external").
write(resolve(here, 'gsm-casedesk-realm.json'), realm({ webUrl: 'http://localhost:3000', sslRequired: 'external' }));
write(
  resolve(here, '../keycloak-production/gsm-casedesk-realm.json'),
  realm({ webUrl: '${CASEDESK_WEB_URL}', sslRequired: 'all' }),
);
