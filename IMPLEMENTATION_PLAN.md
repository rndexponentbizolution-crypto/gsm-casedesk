# GSM CaseDesk Implementation Plan

## Phase status
- [x] Foundation: monorepo, Prisma foundation, authentication configuration, documentation
- [x] Core case management: scoped in-memory development services, field agents, tickets, routing
- [x] Messaging: signed Meta webhook, persistent inbound events and outbox
- [x] Real-time inbox: responsive three-column UI and live API refresh
- [x] Supervision: scoped dashboard metrics, report data and authorised CSV export
- [x] Reliability and security: Keycloak sign-in with MFA-ready production realm, signed Meta webhook, outbox with retries, Operations view, S3 attachments with ClamAV scanning, rate limiting, startup config checks, verifiable audit chain
- [ ] Go-live: hosted infrastructure, Meta business setup and MTN approval (see docs/PRODUCTION.md)

## Architecture
- `apps/web`: Next.js TypeScript dashboard
- `apps/api`: NestJS REST and WebSocket API
- `packages/shared`: shared enums, types and Zod schemas
- `infrastructure`: PostgreSQL, Redis, MinIO and Keycloak Compose configuration
- `scripts`: setup, migrations and seed helpers
- `tests`: integration and end-to-end coverage

## Implementation approach
1. Establish npm workspaces and local services.
2. Build the PostgreSQL/Prisma foundation (reference data only; no sample people).
3. Implement deny-by-default, team-scoped APIs and routing.
4. Add persistent webhook/outbox processing and the official Meta adapter.
5. Build the three-column inbox and supervisor views.
6. Add negative access tests, reliability tests and production documentation.
