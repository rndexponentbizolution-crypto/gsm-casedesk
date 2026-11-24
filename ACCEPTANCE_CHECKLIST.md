# Acceptance Checklist

- [x] Docker services start and migrate cleanly
- [x] Staff authenticate through Keycloak only (MFA, password policy, lockout); no demo sign-in or sample accounts
- [x] Employees cannot access other employees' tickets
- [x] Duplicate webhooks do not duplicate messages
- [x] Text and media flow through the inbound pipeline and the outbox (tested against a stand-in for Meta)
- [x] Administrators create accounts, assign roles and per-person permissions, and deactivate leavers; nobody can lock out the last administrator
- [x] Reassignment revokes former assignee access
- [x] Audit events cover all controlled actions (ticket and case changes, messages, attachment uploads/downloads/rejections, refused access, report exports, retries/dismissals, staff changes; tamper-evident and verifiable with `npm run audit:verify`)
- [x] Failed and stuck work is visible and recoverable (Operations page: retry or dismiss failed/unconfirmed sends, retry stuck incoming messages)
- [ ] External security/compliance approval is recorded

Go-live steps that need accounts, contracts or approvals are in [docs/PRODUCTION.md](docs/PRODUCTION.md).
