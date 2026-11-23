# Production go-live runbook

What has to be true before GSM CaseDesk handles real field agents and customer data, in the order to do it. Items marked **(you)** need an account, a contract, a decision or an approval; everything else is already built and tested.

> **Gate:** per [SECURITY.md](../SECURITY.md), no live customer data until MTN's security, privacy and compliance stakeholders have approved the deployment. Start that conversation first; it takes longest.

## 1. Decisions (you)
- **Hosting region and providers.** The web app is on Vercel and the API on Render today. Confirm with MTN where customer data (database, attachments, backups, logs) may live, and pick providers in that region.
- **Retention periods** for messages, attachments and audit events. CaseDesk keeps everything until told otherwise.
- **Who administers** Keycloak, the database, storage and the Meta app.

## 2. Infrastructure (you)
| Service | Requirement | CaseDesk setting |
| --- | --- | --- |
| PostgreSQL 16+ | Managed, private network, TLS, **daily backups with point-in-time restore**, restore tested | `DATABASE_URL` (add `?sslmode=require`) |
| Object storage (S3 API) | Private bucket, encryption at rest, versioning on, lifecycle rule for the retention period, credentials limited to this bucket | `S3_ENDPOINT` (omit for AWS), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE=false` for AWS, `S3_SSE=AES256` if the provider needs the header |
| ClamAV (clamd) | Reachable only from the API, e.g. the `clamav/clamav` image as a private service | `CLAMAV_HOST`, `CLAMAV_PORT` |
| Keycloak 26 | `start` (not `start-dev`) with its own PostgreSQL, TLS, a fixed hostname | see step 3 |

Without `CLAMAV_HOST`, attachments are stored and served as `NOT_SCANNED` and the API logs a warning at startup.

## 3. Sign-in (Keycloak)
1. Import [`infrastructure/keycloak-production/gsm-casedesk-realm.json`](../infrastructure/keycloak-production/gsm-casedesk-realm.json) with `CASEDESK_WEB_URL` set to the web app's public URL (no trailing slash), e.g. `CASEDESK_WEB_URL=https://casedesk.example.com kc.sh start --import-realm`. It has no users and enforces:
   - HTTPS everywhere; authenticator-app MFA set up at first sign-in
   - passwords of 12+ characters, not the username/email, not one of the last 5
   - lockout after 5 failures (growing wait, up to 15 minutes)
   - sign-in and admin events kept 90 days
2. **(you)** Create each staff member in Keycloak, then give them a CaseDesk account with their Keycloak user ID:
   ```
   npm run staff -- add --keycloak-id <id> --name "Jane Phiri" --email jane@example.com --role BACK_OFFICE --by <your keycloak id>
   ```
   Inside the API container use `node dist/cli/staff.js add ...`. Also `list`, `set-role`, `deactivate`, `reactivate`; every change is audited. Deactivation applies on the person's next request.
3. Leave the development realm (`infrastructure/keycloak/`) and its `casedesk-dev` users out of production.

## 4. API environment
Required: `NODE_ENV=production`, `DATABASE_URL`, `AUTH_MODE=keycloak`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_AUDIENCE`, `WEB_ORIGIN` (the web URL, for CORS), the `S3_*` settings, `CLAMAV_HOST`.
Live WhatsApp additionally: `SIMULATION_ENABLED=false`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_GRAPH_VERSION`.
Optional: `KEYCLOAK_ISSUER` (if the API reaches Keycloak on a different URL than browsers), `RATE_LIMIT_PER_MINUTE` (default 300 per client IP), `TRUST_PROXY` (default 1 hop in production), `SWAGGER_ENABLED=true` (API docs are off in production by default), `WORKERS_ENABLED=false` (to run an API instance that serves requests but does not send/process messages).

The API **refuses to start** with unsafe settings: demo sign-in in production, live WhatsApp without the Meta credentials or a bucket, or the development storage keys in production. Fix what the error lists.

The container runs `prisma migrate deploy` before starting, so deploys apply migrations automatically. Several API instances can run at once; message workers coordinate through the database.

## 5. Web environment (build time)
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE=keycloak`, `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`. These are compiled into the bundle: change them, then redeploy. (Vercel is currently set to `NEXT_PUBLIC_AUTH_MODE=demo` as a stop-gap; switch it back to `keycloak`.)

## 6. Meta WhatsApp Cloud API (you)
1. Meta Business verification; a WhatsApp Business Account with the support phone number registered.
2. A **System User** access token with `whatsapp_business_messaging` (and `whatsapp_business_management`), not a temporary user token.
3. In the Meta app: Webhooks → callback URL `https://<api-host>/webhooks/whatsapp`, verify token = `META_VERIFY_TOKEN`, subscribe to the **messages** field. Meta checks the URL immediately, so deploy the API with the Meta settings first.
4. Set `SIMULATION_ENABLED=false` and redeploy. `/health` reports `"mode": "live"`; the simulator is then switched off.

How it behaves live:
- Incoming messages are stored first and processed by a worker; Meta's re-deliveries are de-duplicated. Messages from numbers that aren't registered field agents are ignored (visible in Operations, retryable once the agent is added).
- Outgoing messages (bot and staff) go through an outbox: retried with backoff (5 s doubling to 10 min, 6 attempts) on temporary errors, failed immediately on permanent ones.
- A send interrupted mid-request is marked **Unconfirmed** rather than re-sent, because it may already have arrived.
- Supervisors see all of this under **Operations** (and a banner on the dashboard), with Retry and Dismiss.

**Known limitation:** replies outside WhatsApp's 24-hour customer-service window need pre-approved template messages, which CaseDesk does not send yet. Such replies fail with Meta error 131047 and show in Operations. Agents normally message first, so the window is usually open.

## 7. Monitoring and operations
- **Uptime:** alert on `GET /health` (returns `"status": "degraded"` when the database is unreachable).
- **Audit integrity:** run `npm run audit:verify` (container: `node dist/cli/audit-verify.js`) nightly; it exits 1 if any audit event was altered or removed. Supervisors can also call `GET /api/audit/verify`.
- **Failed/stuck messages:** the Operations page; consider alerting when the dashboard counts are non-zero.
- **Logs:** ship API and Keycloak logs to the log service MTN approves. **(you)** Error tracking (e.g. Sentry) is not integrated yet.
- **Backups:** monthly restore drill of the database and a sample of attachments.

## 8. Security checklist (you)
- [ ] MTN security/privacy/compliance approval recorded (ACCEPTANCE_CHECKLIST.md)
- [ ] Penetration test of the deployed system, findings fixed
- [ ] 2FA on every admin account: GitHub, Vercel, Render (or replacements), Meta Business, the cloud/database/storage consoles, Keycloak admin
- [ ] Secrets only in the platforms' secret stores; development values (`change-me`, `casedesk-dev`) nowhere
- [ ] Production Keycloak has no development users; Vercel and the API are back on `keycloak` sign-in
- [ ] Data retention periods agreed and configured (bucket lifecycle now; database retention job still to build)

## 9. Rolling back
- **Sign-in problems:** fix Keycloak; never switch production to demo mode (the API refuses to start that way).
- **WhatsApp problems:** set `SIMULATION_ENABLED=true` and redeploy to stop all sending. Messages already queued stay in the outbox and resume when live mode returns; check Operations afterwards.
- **Bad deploy:** redeploy the previous image. Migrations only add columns and indexes, so the previous version still runs against the newer schema.
