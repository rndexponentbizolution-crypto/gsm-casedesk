import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

// Boots the real module (global guard included) over a fake database, so this runs
// without PostgreSQL. Demo mode stands in for Keycloak; token checks are in auth.spec.ts.
const USERS = {
  'demo-agent-1': {
    keycloakId: 'demo-agent-1',
    role: 'BACK_OFFICE',
    name: 'Martha Banda',
    active: true,
  },
};

const fakePrisma = {
  $queryRaw: () => Promise.resolve([{ ok: 1 }]),
  user: {
    findUnique: ({ where }: { where: { keycloakId: string } }) =>
      Promise.resolve(USERS[where.keycloakId as keyof typeof USERS] ?? null),
  },
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
  ['post', '/api/simulator/inbound'],
  ['get', '/api/field-agents'],
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
];

describe('API authentication (HTTP)', () => {
  let app: INestApplication<App>;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.AUTH_MODE = 'demo';
    process.env.NODE_ENV = 'test';
    delete process.env.S3_BUCKET; // in-memory storage; no MinIO needed
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
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

  it('refuses a signed-in identity with no CaseDesk account', async () => {
    await request(app.getHttpServer())
      .get('/api/me')
      .set('x-demo-user', 'nobody')
      .expect(403);
  });

  it('returns the caller with the role from their account', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/me')
      .set('x-demo-user', 'demo-agent-1')
      .set('x-demo-role', 'SUPERVISOR')
      .expect(200);
    expect(res.body).toEqual({
      id: 'demo-agent-1',
      role: 'BACK_OFFICE',
      name: 'Martha Banda',
    });
  });
});
