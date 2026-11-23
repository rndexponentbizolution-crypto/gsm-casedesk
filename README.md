# GSM CaseDesk

GSM CaseDesk is a secure, human-operated WhatsApp case management platform for back-office field-agent support.

## Requirements
- Node.js 20+
- PostgreSQL 16+
- Redis 7+ (optional in simulation mode)
- Docker Desktop or Docker Engine (recommended)

## Local development
Run the services in Docker and the apps on your machine:
```powershell
npm install
cp .env.example .env
docker compose up -d postgres redis minio keycloak
npm run db:migrate
npm run db:seed
npm run dev
```

The API, Prisma, the tests and the web app all read the root `.env`. PostgreSQL is published on host port **5433** (set `POSTGRES_HOST_PORT` to change it), so a locally installed PostgreSQL on 5432 doesn't get in the way.

Or run everything in Docker (the API applies migrations on start):
```powershell
docker compose up -d --build
npm run db:seed   # once, from your machine, using the root .env
```

- Web: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs
- MinIO: http://localhost:9001
- Keycloak: http://localhost:8080 (sign in as `chanda`, `martha` or `peter`, password `casedesk-dev`)

Sign-in uses Keycloak by default. To work without Keycloak, set `AUTH_MODE=demo` and `NEXT_PUBLIC_AUTH_MODE=demo` (development only). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#sign-in-keycloak).

## WhatsApp
CaseDesk runs a database-backed simulation by default (`SIMULATION_ENABLED=true`). Live delivery through Meta's WhatsApp Cloud API is built in and switches on with `SIMULATION_ENABLED=false` plus the Meta credentials; it is never enabled by default.

## Going to production
[docs/PRODUCTION.md](docs/PRODUCTION.md) is the go-live runbook: infrastructure, Keycloak, Meta setup, monitoring, and the approvals needed first.
