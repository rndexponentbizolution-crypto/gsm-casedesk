import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './app.module';
import { TokenVerifier } from './auth';
import { PrismaService } from './prisma.service';

// Boots the real module (global guards included) over a fake database and a fake
// token verifier ("Bearer valid:<id>"), so this runs without PostgreSQL or Keycloak.
const person = (keycloakId: string, role: string, extra: Partial<Record<string, unknown>> = {}) => ({
  keycloakId,
  role,
  name: keycloakId,
  email: `${keycloakId}@example.test`,
  active: true,
  grantedPermissions: [] as string[],
  revokedPermissions: [] as string[],
  ...extra,
});
const USERS: Record<string, ReturnType<typeof person>> = {
  agent: person('agent', 'BACK_OFFICE'),
  admin: person('admin', 'ADMINISTRATOR'),
  'agent-with-reports': person('agent-with-reports', 'BACK_OFFICE', { grantedPermissions: ['reports.view'] }),
};

const fakePrisma = {
  $queryRaw: () => Promise.resolve([{ ok: 1 }]),
  user: {
    findUnique: ({ where }: { where: { keycloakId: string } }) =>
      Promise.resolve(USERS[where.keycloakId] ?? null),
  },
};
const fakeTokens = {
  verify: (token: string) =>
    token.startsWith('valid:') ? Promise.resolve(token.slice(6)) : Promise.reject(new Error('bad')),
};

const PROTECTED: Array<['get' | 'post' | 'patch', string]> = [
  ['get', '/api/me'],
  ['get', '/api/dashboard'],
  ['get', '/api/tickets'],
  ['get', '/api/tickets/t1'],
  ['post', '/api/tickets/t1/reply'],
  ['patch', '/api/tickets/t1/case'],
  ['post', '/api/tickets/t1/reassign'],
  ['post', '/api/tickets/t1/status'],
  ['get', '/api/query-types'],
  ['get', '/api/responses'],
  ['get', '/api/field-agents'],
  ['post', '/api/field-agents'],
  ['patch', '/api/field-agents/f1'],
  ['get', '/api/reports'],
  ['get', '/api/reports.csv'],
  ['get', '/api/reports/daily-log.csv'],
  ['post', '/api/tickets/t1/media'],
  ['get', '/api/attachments/a1'],
  ['get', '/api/operations'],
  ['post', '/api/operations/outbound/o1/retry'],
  ['post', '/api/operations/outbound/o1/dismiss'],
  ['post', '/api/operations/inbound/i1/retry'],
  ['get', '/api/audit/verify'],
  ['get', '/api/staff'],
  ['get', '/api/staff/permissions'],
  ['post', '/api/staff'],
  ['patch', '/api/staff/s1'],
  ['post', '/api/staff/s1/reset-password'],
];

/** Routes a back-office account (no extra grants) must be refused, before any data access. */
const ADMIN_ONLY: Array<['get' | 'post' | 'patch', string]> = [
  ['get', '/api/staff'],
  ['get', '/api/staff/permissions'],
  ['post', '/api/staff'],
  ['patch', '/api/staff/s1'],
  ['post', '/api/staff/s1/reset-password'],
  ['post', '/api/field-agents'],
  ['patch', '/api/field-agents/f1'],
  ['get', '/api/operations'],
  ['post', '/api/operations/outbound/o1/retry'],
  ['get', '/api/reports'],
  ['get', '/api/reports.csv'],
  ['get', '/api/reports/daily-log.csv'],
  ['get', '/api/audit/verify'],
  ['post', '/api/tickets/t1/reassign'],
];

describe('API authentication and permissions (HTTP)', () => {
  let app: INestApplication<App>;
  const saved = { ...process.env };
  const as = (id: string) => ({ authorization: `Bearer valid:${id}` });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.S3_BUCKET; // in-memory storage; no MinIO needed
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(TokenVerifier)
      .useValue(fakeTokens)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('serves /health without signing in', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it.each(PROTECTED)('refuses anonymous %s %s', async (method, path) => {
    await request(app.getHttpServer())[method](path).expect(401);
  });

  it('ignores the removed demo sign-in headers', async () => {
    await request(app.getHttpServer()).get('/api/me').set('x-demo-user', 'admin').expect(401);
  });

  it('refuses a signed-in identity with no CaseDesk account', async () => {
    await request(app.getHttpServer()).get('/api/me').set(as('nobody')).expect(403);
  });

  it('returns the caller with role and permissions from their account', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/me')
      .set(as('agent'))
      .set('x-demo-role', 'ADMINISTRATOR')
      .expect(200);
    expect(res.body).toMatchObject({ id: 'agent', role: 'BACK_OFFICE', permissions: ['tickets.reply'] });
  });

  it.each(ADMIN_ONLY)('refuses back office %s %s', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).set(as('agent')).send({});
    expect(res.status).toBe(403);
  });

  it('honours a per-person grant', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').set(as('agent-with-reports')).expect(200);
    expect(res.body.permissions).toContain('reports.view');
  });

  it('lets an administrator read the permission catalogue', async () => {
    const res = await request(app.getHttpServer()).get('/api/staff/permissions').set(as('admin')).expect(200);
    expect(res.body.permissions.map((p: { key: string }) => p.key)).toContain('staff.manage');
  });

  it('no longer has a simulator', async () => {
    await request(app.getHttpServer()).post('/api/simulator/inbound').set(as('admin')).send({}).expect(404);
  });
});
