# Acceptance Checklist

- [x] Docker services start and migrate cleanly
- [x] Synthetic OIDC users authenticate
- [x] Employees cannot access other employees' tickets
- [x] Duplicate webhooks do not duplicate messages
- [x] Simulation sends and receives text and media
- [x] Reassignment revokes former assignee access
- [x] Audit events cover all controlled actions (ticket and case changes, messages, attachment uploads/downloads/rejections, refused access, report exports, retries/dismissals, staff changes; tamper-evident and verifiable with `npm run audit:verify`)
- [x] Failed and stuck work is visible and recoverable (Operations page: retry or dismiss failed/unconfirmed sends, retry stuck incoming messages)
- [ ] External security/compliance approval is recorded

Go-live steps that need accounts, contracts or approvals are in [docs/PRODUCTION.md](docs/PRODUCTION.md).
