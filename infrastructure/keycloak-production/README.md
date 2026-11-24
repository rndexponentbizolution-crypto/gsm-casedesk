# Production Keycloak realm

`gsm-casedesk-realm.json` is the production version of `../keycloak/gsm-casedesk-realm.json`: same clients, no users, and production security settings (HTTPS required, MFA at first sign-in, password policy, lockout, sign-in and admin event logging).

Import it with the web app's public URL in `CASEDESK_WEB_URL` (no trailing slash); Keycloak substitutes it into the client's redirect URIs, web origins and logout URIs:

```
CASEDESK_WEB_URL=https://casedesk.example.com kc.sh start --import-realm
```

Import runs once per realm (existing realms are skipped). Change settings afterwards in the admin console, or re-import into a fresh database.

See [docs/PRODUCTION.md](../../docs/PRODUCTION.md#3-sign-in-keycloak) for onboarding staff.
