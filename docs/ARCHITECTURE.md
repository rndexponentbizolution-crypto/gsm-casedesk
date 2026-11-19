# Architecture

GSM CaseDesk is a modular monolith with a Next.js dashboard and NestJS API.

- PostgreSQL/Prisma defines persistent tickets, contacts, messages, inbox/outbox and tamper-evidencing audit entities.
- The development API uses an explicitly scoped in-memory store while external infrastructure is unavailable.
- WhatsApp webhook and outbound integrations share durable event boundaries in the Prisma model.
- Server-side role checks deny cross-agent ticket access.
- The UI is a responsive three-column inbox with separate incoming/outgoing/simulated message presentation.
