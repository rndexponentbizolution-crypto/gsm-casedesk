# GSM CaseDesk

GSM CaseDesk is a secure, human-operated WhatsApp case management platform for back-office field-agent support.

## Requirements
- Node.js 20+
- PostgreSQL 16+
- Redis 7+ (optional in simulation mode)
- Docker Desktop or Docker Engine (recommended)

## Local development
```powershell
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs
- MinIO: http://localhost:9001

## WhatsApp
The system will run a persistent database-backed simulation until Meta credentials are supplied. Live delivery requires Meta Cloud API approval and is never enabled by default.
