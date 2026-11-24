# GSM CaseDesk

GSM CaseDesk is a secure, human-operated WhatsApp case management platform for back-office field-agent support.

## Requirements
- Node.js 20+
- PostgreSQL 16+
- Redis 7+ (optional in simulation mode)
- Docker Desktop or Docker Engine (recommended)

## Local development
There are no sample accounts or sample data. You create the first administrator yourself; everyone and everything else is added in CaseDesk.

```powershell
npm install
node infrastructure/generate-secrets.mjs           # creates .env with random secrets
docker compose up -d postgres redis minio keycloak
npm run db:migrate
npm run db:seed                                    # reference data only
npm run staff -- bootstrap-admin --email you@example.com --name "Your Name"
npm run dev
```

Run `bootstrap-admin` in your own terminal: it prints a one-time temporary password, once. At first sign-in you choose your own password and set up an authenticator app. It only works while nobody can manage staff, so it can't add a second administrator later.

The API, Prisma, the tests and the web app all read the root `.env`. The tests use their own database (`casedesk_test`, created automatically) and never touch your data. PostgreSQL is published on host port **5433** (`POSTGRES_HOST_PORT`), Keycloak on **8080** (`KEYCLOAK_HOST_PORT`; change it and the two Keycloak URLs in `.env` if 8080 is taken).

Or run everything in Docker (the API applies migrations on start):
```powershell
docker compose up -d --build
```

- Web: http://localhost:3000
- API: http://localhost:3001 (Swagger at `/docs`, development only)
- Keycloak admin console: http://localhost:8080/admin (user `keycloak-admin`, password `KC_BOOTSTRAP_ADMIN_PASSWORD` in `.env`)
- MinIO console: http://localhost:9001

Every port is bound to `127.0.0.1`: nothing is reachable from other machines.

## Accounts and permissions
Staff sign in through Keycloak only. An administrator manages accounts under **Staff & access**: creating someone makes their Keycloak sign-in and shows a one-time password to hand over; each person gets a role (Back office, Supervisor, Administrator) whose default permissions can then be granted or removed individually. Deactivating someone disables their sign-in at once. Field agents are added under **Field agents**. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#sign-in-and-permissions).

## WhatsApp
Until live WhatsApp is connected (`SIMULATION_ENABLED=true`, the default), replies are recorded but not sent and no messages come in. Live delivery through Meta's WhatsApp Cloud API is built in and switches on with `SIMULATION_ENABLED=false` plus the Meta credentials.

## Going to production
[docs/PRODUCTION.md](docs/PRODUCTION.md) is the go-live runbook: infrastructure, Keycloak, Meta setup, monitoring, and the approvals needed first.
