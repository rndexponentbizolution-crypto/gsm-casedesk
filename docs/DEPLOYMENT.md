# Deployment

## Development
1. `npm install`, then `node infrastructure/generate-secrets.mjs`. It creates the root `.env` from `.env.example` and fills every secret with a random value (database, Keycloak's database and admin console, the account-management client, MinIO). Docker Compose refuses to start while any secret is empty. The API, Prisma, the tests and the web app all read this file; real environment variables take precedence.
2. Start the services: `docker compose up -d postgres redis minio keycloak`.
3. `npm run db:migrate`, then `npm run db:seed` (reference data only: there are no sample staff, field agents or tickets).
4. Create the first administrator, in your own terminal: `npm run staff -- bootstrap-admin --email you@example.com --name "Your Name"`. It prints a one-time temporary password.
5. `npm run dev`, open http://localhost:3000 and sign in. You will choose your own password and set up an authenticator app.

Every Compose port is bound to `127.0.0.1`. PostgreSQL is on host port 5433 (`POSTGRES_HOST_PORT`), Keycloak on 8080 (`KEYCLOAK_HOST_PORT`).

To run the whole stack in containers instead, use `docker compose up -d --build`; the API image runs `prisma migrate deploy` before starting, and `node dist/cli/staff.js bootstrap-admin ...` works inside the API container. Both images build from the repository root (`apps/api/Dockerfile`, `apps/web/Dockerfile`). The web app's `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they are build args in `docker-compose.yml`; change them there and rebuild.

Tests (`npm test`) run against a separate `casedesk_test` database (or `TEST_DATABASE_URL`), created and migrated automatically; they refuse any database not named `*_test` on a local host.

MinIO no longer publishes Docker images, so Compose uses Chainguard's build of the same server (`cgr.dev/chainguard/minio`, `:latest` only on the free tier).

## Sign-in and permissions
Keycloak authenticates staff; CaseDesk decides what they may do. Every API route except `/health` and the signed Meta webhook requires a Keycloak access token whose subject matches an **active** CaseDesk account. There is no other way in: the old demo sign-in has been removed, and `AUTH_MODE` is ignored.

Keycloak keeps its data in its own PostgreSQL database (`keycloak`), so recreating its container loses nothing. The realm (`infrastructure/keycloak/gsm-casedesk-realm.json`, generated with `infrastructure/keycloak/build-realms.mjs`) holds no people, only:
- `gsm-casedesk-web`: public client, authorisation code with PKCE, and an audience mapper adding `gsm-casedesk-api` to access tokens.
- `gsm-casedesk-api`: bearer-only client representing the API.
- `gsm-casedesk-admin`: CaseDesk's account-management client. Its service account can manage the realm's users and nothing else (not realm settings, not other realms). Its secret is `KEYCLOAK_ADMIN_CLIENT_SECRET`, substituted at import.
- Security: authenticator-app MFA at first sign-in, passwords of 12+ characters not reused from the last 5, lockout after 5 failures, no self-registration, sign-in and admin events kept 90 days.

Permissions (each person: role defaults, plus grants, minus revokes):

| Permission | Back office | Supervisor | Administrator |
| --- | --- | --- | --- |
| Work tickets (`tickets.reply`) | yes | yes | yes |
| See all tickets (`tickets.view_all`) | | yes | yes |
| Reassign tickets (`tickets.reassign`) | | yes | yes |
| View reports (`reports.view`) | | yes | yes |
| Export reports (`reports.export`) | | yes | yes |
| Message operations (`operations.manage`) | | yes | yes |
| Verify audit trail (`audit.verify`) | | yes | yes |
| Manage field agents (`field_agents.manage`) | | | yes |
| Manage staff & access (`staff.manage`) | | | yes |

Safeguards: nobody can remove their own staff-management access or deactivate themselves, and CaseDesk refuses any change that would leave nobody able to manage staff. Every account change is audited; temporary passwords are never stored or logged.

Break-glass tools (`npm run staff -- ...`, or `node dist/cli/staff.js ...` in the container): `list`, `bootstrap-admin` (only while no administrator exists), `deactivate`, `reactivate`.

## Meta WhatsApp
`SIMULATION_ENABLED=true` (the default): replies are recorded but never sent, and nothing comes in. `SIMULATION_ENABLED=false` switches to live WhatsApp: Meta's signed webhook at `/webhooks/whatsapp` is the only way in (the raw-body `X-Hub-Signature-256` is verified against `META_APP_SECRET`), and outbound messages are delivered through the outbox. Setup, behaviour and limits are in [PRODUCTION.md](PRODUCTION.md#6-meta-whatsapp-cloud-api-you).

## Attachments and virus scanning
Attachments are stored in S3-compatible storage (`S3_*`; MinIO in Compose). Leaving `S3_BUCKET` empty keeps them in memory instead (offline mode only). To scan them locally, run `docker compose --profile scan up -d clamav` and set `CLAMAV_HOST=localhost`; infected files are never stored or served.

## Production
See [PRODUCTION.md](PRODUCTION.md) for the go-live runbook.

## Operations
- Back up PostgreSQL (both the `casedesk` and `keycloak` databases) before upgrades.
- Monitor `/health`, the Operations page, and run `npm run audit:verify` nightly.
- Use HTTPS and keep PostgreSQL, Redis, Keycloak's admin console and MinIO off the public network.
- Never deploy real customer data before MTN security and compliance approval.
