# Deployment

## Development
1. Copy `.env.example` to `.env`. The API, Prisma, the API tests and the web app all read this root file; real environment variables take precedence.
2. Start the services: `docker compose up -d postgres redis minio keycloak`.
3. Run `npm install`, `npm run db:migrate`, and `npm run db:seed`.
4. Start the apps with `npm run dev`.

PostgreSQL is published on host port 5433 (`POSTGRES_HOST_PORT`) so it never collides with a locally installed PostgreSQL on 5432.

To run the whole stack in containers instead, use `docker compose up -d --build`, then seed once from your machine with `npm run db:seed`. The API image runs `prisma migrate deploy` before starting. Both images build from the repository root (`apps/api/Dockerfile`, `apps/web/Dockerfile`). The web app's `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they are build args in `docker-compose.yml`; change them there and rebuild.

MinIO no longer publishes Docker images, so Compose uses Chainguard's build of the same server (`cgr.dev/chainguard/minio`, `:latest` only on the free tier).

Docker is the intended local host for PostgreSQL, Redis, MinIO and Keycloak. The current development API also has an explicitly labelled in-memory simulation mode for environments without Docker.

## Sign-in (Keycloak)
Keycloak authenticates staff; CaseDesk decides what they may do. Every API route except `/health` requires a Keycloak access token whose subject (`sub`) matches an **active** CaseDesk `User.keycloakId`. The user's role comes from that CaseDesk record, so a valid Keycloak login with no CaseDesk account is refused with 403.

The imported development realm `gsm-casedesk` contains:
- `gsm-casedesk-web`: public client, authorisation-code flow with PKCE (S256), and an audience mapper that adds `gsm-casedesk-api` to access tokens.
- `gsm-casedesk-api`: bearer-only client representing the API audience.
- Development users whose Keycloak IDs match the seeded CaseDesk users. Password: `casedesk-dev`.

| Username | CaseDesk user | Role |
| --- | --- | --- |
| `chanda` | `demo-supervisor` | Supervisor |
| `martha` | `demo-agent-1` | Back office |
| `peter` | `demo-agent-2` | Back office |

Environment:
- API: `AUTH_MODE=keycloak`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_AUDIENCE`, plus `KEYCLOAK_ISSUER` when the API reaches Keycloak on a different URL than browsers do.
- Web (build time): `NEXT_PUBLIC_AUTH_MODE=keycloak`, `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`.

For a hosted deployment, add the web app's public URL to the `gsm-casedesk-web` client's redirect URIs, web origins and post-logout redirect URIs. Remove the development users.

To add a staff member: create them in Keycloak, then create a CaseDesk `User` whose `keycloakId` is their Keycloak user ID.

`AUTH_MODE=demo` (with `NEXT_PUBLIC_AUTH_MODE=demo`) restores the persona picker for local work without Keycloak. The API then trusts an `x-demo-user` header, takes the role from the database, and refuses to start when `NODE_ENV=production`.

## Meta WhatsApp
Supply only approved Meta secrets as environment variables. Configure the webhook endpoint on an HTTPS reverse proxy, validate the raw-body `X-Hub-Signature-256`, and keep `SIMULATION_ENABLED=false` in production.

## Operations
- Back up PostgreSQL before upgrades.
- Monitor `/health`, stuck inbox rows, failed outbox rows and worker heartbeats.
- Use HTTPS and restrict PostgreSQL/Redis/Keycloak/MinIO from the public network.
- Never deploy real customer data before MTN security and compliance approval.
