import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './app.module';
import { MessagingService } from './messaging.service';
import { PrismaService } from './prisma.service';

// The Meta webhook over real HTTP: public, but only accepts correctly signed bodies.
describe('WhatsApp webhook (HTTP)', () => {
  let app: INestApplication<App>;
  const received: unknown[] = [];
  const saved = { ...process.env };
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sign = (raw: string, secret = 'test-secret') =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_MODE = 'keycloak';
    process.env.META_APP_SECRET = 'test-secret';
    process.env.META_VERIFY_TOKEN = 'verify-me';
    delete process.env.S3_BUCKET;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(MessagingService)
      .useValue({
        receiveWebhook: (payload: unknown) => {
          received.push(payload);
          return Promise.resolve({ messages: 0, statuses: 0 });
        },
      })
      .compile();
    // Same option main.ts uses; the signature covers the raw bytes.
    app = module.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('answers Meta\'s subscription check only with the right verify token', async () => {
    await request(app.getHttpServer())
      .get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345')
      .expect(200, '12345');
    await request(app.getHttpServer())
      .get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')
      .expect(403);
  });

  it('accepts a correctly signed delivery without a sign-in token', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200);
    expect(received).toHaveLength(1);
  });

  it('rejects unsigned, wrongly signed and altered deliveries', async () => {
    const before = received.length;
    await request(app.getHttpServer()).post('/webhooks/whatsapp').set('content-type', 'application/json').send(body).expect(401);
    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body, 'other-secret'))
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body.replace('[]', '[{}]'))
      .expect(401);
    expect(received).toHaveLength(before);
  });
});
