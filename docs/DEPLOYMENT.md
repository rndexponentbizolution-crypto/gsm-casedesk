# Deployment

## Development
1. Copy `.env.example` to `.env`.
2. Start Docker services: `docker compose up --build`.
3. In another terminal run `npm install`, `npm run db:migrate`, and `npm run db:seed`.
4. Start the app with `npm run dev`.

Docker is the intended local host for PostgreSQL, Redis, MinIO and Keycloak. The current development API also has an explicitly labelled in-memory simulation mode for environments without Docker.

## Keycloak
The imported development realm is `gsm-casedesk`. Configure users and synthetic roles in Keycloak for OIDC testing. Do not use the synthetic `x-demo-*` headers outside development.

## Meta WhatsApp
Supply only approved Meta secrets as environment variables. Configure the webhook endpoint on an HTTPS reverse proxy, validate the raw-body `X-Hub-Signature-256`, and keep `SIMULATION_ENABLED=false` in production.

## Operations
- Back up PostgreSQL before upgrades.
- Monitor `/health`, stuck inbox rows, failed outbox rows and worker heartbeats.
- Use HTTPS and restrict PostgreSQL/Redis/Keycloak/MinIO from the public network.
- Never deploy real customer data before MTN security and compliance approval.
