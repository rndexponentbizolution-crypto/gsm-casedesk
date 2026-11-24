import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { AuditService } from './audit.service';
import { MessagingService } from './messaging.service';
import { PrismaService } from './prisma.service';
import { ScannerService } from './scanner';
import { StorageService } from './storage';
import { MetaClient, MetaError } from './whatsapp';

import {
  AGENT_1,
  AGENT_2,
  assertTestDatabase,
  JOSEPH,
  seedFixtures,
  SUP,
} from './test-fixtures.jest';

// Live-mode messaging against the separate *_test database, with Meta faked out.
assertTestDatabase();

const BACK_OFFICE = { [AGENT_1.id]: AGENT_1, [AGENT_2.id]: AGENT_2 };

/** Stands in for Meta. Queue results per call; default is success. */
class FakeMeta {
  sent: Array<Record<string, unknown>> = [];
  uploads: string[] = [];
  failures: Error[] = [];
  private seq = 0;
  send(message: Record<string, unknown>) {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.sent.push(message);
    return Promise.resolve(`wamid.test.${++this.seq}.${Date.now()}`);
  }
  uploadMedia(_file: Buffer, _mime: string, filename: string) {
    this.uploads.push(filename);
    return Promise.resolve('META-MEDIA-1');
  }
  downloadMedia() {
    return Promise.resolve({ body: Buffer.from('%PDF-1.4 fake'), mimeType: 'application/pdf' });
  }
}

class MemoryStorage {
  objects = new Map<string, Buffer>();
  put(key: string, body: Buffer) {
    this.objects.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    return Promise.resolve(this.objects.get(key)!);
  }
}

let seq = 0;
const webhookFor = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            messages: [{ from: JOSEPH.slice(1), id: `wamid.in.${++seq}.${Date.now()}`, ...message }],
          },
        },
      ],
    },
  ],
});

describe('Live messaging', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let app: AppService;
  let messaging: MessagingService;
  let audits: AuditService;
  let meta: FakeMeta;
  const saved = { ...process.env };

  /** Inbound text from Joseph through the webhook, then one worker pass. */
  const inbound = async (message: Record<string, unknown>) => {
    await messaging.receiveWebhook(webhookFor(message));
    await messaging.tick();
  };
  const ticketOf = async () =>
    (await prisma.ticket.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id;
  /** Walks the bot to an assigned PIN reset. */
  const openPinReset = async () => {
    await inbound({ type: 'text', text: { body: 'Hi' } });
    await inbound({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'PIN_RESET', title: 'PIN reset' } },
    });
    await inbound({ type: 'text', text: { body: 'Customer 0971234567, NRC attached' } });
    return ticketOf();
  };

  beforeAll(async () => {
    meta = new FakeMeta();
    module = await Test.createTestingModule({
      providers: [AppService, AuditService, MessagingService, PrismaService, ScannerService],
    })
      .useMocker((token) => {
        if (token === StorageService) return new MemoryStorage();
        if (token === MetaClient) return meta;
      })
      .compile();
    prisma = module.get(PrismaService);
    app = module.get(AppService);
    messaging = module.get(MessagingService);
    audits = module.get(AuditService);
    await prisma.$connect();
    await seedFixtures(prisma);
  });

  beforeEach(async () => {
    process.env.SIMULATION_ENABLED = 'false';
    delete process.env.CLAMAV_HOST;
    meta.sent = [];
    meta.uploads = [];
    meta.failures = [];
    await prisma.$transaction([
      prisma.outboundMessageOutbox.deleteMany(),
      prisma.inboundWebhookEvent.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.ticketStatusHistory.deleteMany(),
      prisma.ticketAssignment.deleteMany(),
      prisma.attachment.deleteMany(),
      prisma.message.deleteMany(),
      prisma.ticket.deleteMany(),
      prisma.conversation.deleteMany(),
      prisma.whatsAppContact.deleteMany(),
    ]);
  });

  afterAll(async () => {
    process.env = saved;
    await module.close();
  });

  it('turns a webhook message into a ticket and sends the bot menu through Meta', async () => {
    await inbound({ type: 'text', text: { body: 'Hi' } });
    const ticket = await app.ticket(SUP, await ticketOf());
    expect(ticket!.messages.map((m) => [m.direction, m.state, m.simulated])).toEqual([
      ['INBOUND', 'DELIVERED', false],
      ['OUTBOUND', 'SENT', false],
    ]);
    expect(meta.sent).toHaveLength(1);
    expect(meta.sent[0]).toMatchObject({ to: '260970000001', type: 'interactive' });
    const event = await prisma.inboundWebhookEvent.findFirstOrThrow();
    expect(event.status).toBe('PROCESSED');
  });

  it('drops Meta re-deliveries of the same message', async () => {
    const payload = webhookFor({ type: 'text', text: { body: 'Hi' } });
    await messaging.receiveWebhook(payload);
    await messaging.receiveWebhook(payload);
    await messaging.tick();
    expect(await prisma.inboundWebhookEvent.count()).toBe(1);
    expect(await prisma.message.count({ where: { direction: 'INBOUND' } })).toBe(1);
  });

  it('ignores numbers that are not registered field agents', async () => {
    await messaging.receiveWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ from: '15550001111', id: 'wamid.stranger', type: 'text', text: { body: 'hello' } }] } }] }],
    });
    await messaging.tick();
    const event = await prisma.inboundWebhookEvent.findFirstOrThrow();
    expect(event.status).toBe('IGNORED');
    expect(await prisma.ticket.count()).toBe(0);
  });

  it('queues staff replies, retries temporary errors with backoff, then sends', async () => {
    const id = await openPinReset();
    meta.sent = [];
    meta.failures = [new MetaError('Meta API 500', 500)];
    await app.reply(AGENT_1, id, 'On it');
    await messaging.tick();
    const row = await prisma.outboundMessageOutbox.findFirstOrThrow({ where: { status: { not: 'SENT' } } });
    expect(row).toMatchObject({ status: 'PENDING', retryCount: 1 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // The supervisor view shows it while it is retrying.
    const ops = await messaging.operations(SUP);
    expect(ops.outbound.map((o) => o.id)).toContain(row.id);

    await prisma.outboundMessageOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } });
    await messaging.tick();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: row.messageId } });
    expect(message.state).toBe('SENT');
    expect(message.providerId).toMatch(/^wamid\./);
    expect(meta.sent.at(-1)).toMatchObject({ type: 'text', text: { body: 'On it' } });
    const types = (await prisma.auditEvent.findMany({ where: { ticketId: id } })).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['MESSAGE_QUEUED', 'MESSAGE_SENT']));
  });

  it('fails permanently on a permanent Meta error; a supervisor can retry or dismiss', async () => {
    const id = await openPinReset();
    meta.failures = [new MetaError('Re-engagement required', 400, 131047)];
    await app.reply(AGENT_1, id, 'Hello again');
    await messaging.tick();
    const failed = await prisma.outboundMessageOutbox.findFirstOrThrow({ where: { status: 'FAILED' } });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: failed.messageId } })).state).toBe('FAILED');
    expect((await app.dashboard(SUP)).failedOutbound).toBe(1);

    await expect(messaging.retryOutbound(AGENT_1, failed.id)).rejects.toBeInstanceOf(ForbiddenException);
    await messaging.retryOutbound(SUP, failed.id);
    await messaging.tick();
    expect((await prisma.outboundMessageOutbox.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe('SENT');

    meta.failures = [new MetaError('Bad recipient', 400, 131026)];
    await app.reply(AGENT_1, id, 'One more');
    await messaging.tick();
    const second = await prisma.outboundMessageOutbox.findFirstOrThrow({ where: { status: 'FAILED' } });
    await messaging.dismissOutbound(SUP, second.id);
    expect((await prisma.outboundMessageOutbox.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('DISMISSED');
    const types = (await prisma.auditEvent.findMany({ where: { ticketId: id } })).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['MESSAGE_FAILED', 'OUTBOUND_RETRIED', 'OUTBOUND_DISMISSED']));
  });

  it('marks a send interrupted mid-flight as ambiguous instead of re-sending it', async () => {
    const id = await openPinReset();
    await app.reply(AGENT_1, id, 'Checking');
    const row = await prisma.outboundMessageOutbox.findFirstOrThrow({ where: { status: 'PENDING' } });
    // Simulate a worker that claimed it and died ten minutes ago.
    await prisma.$executeRaw`UPDATE "OutboundMessageOutbox" SET status = 'SENDING', "updatedAt" = now() - interval '10 minutes' WHERE id = ${row.id}`;
    const before = meta.sent.length;
    await messaging.tick();
    expect((await prisma.outboundMessageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('AMBIGUOUS');
    expect((await prisma.message.findUniqueOrThrow({ where: { id: row.messageId } })).state).toBe('AMBIGUOUS');
    expect(meta.sent.length).toBe(before);
  });

  it('applies delivery receipts in order and never moves a message backwards', async () => {
    await inbound({ type: 'text', text: { body: 'Hi' } });
    const bot = await prisma.message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
    const receipt = (status: string) => ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: bot.providerId, status }] } }] }],
    });
    await messaging.receiveWebhook(receipt('read'));
    await messaging.receiveWebhook(receipt('delivered'));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: bot.id } })).state).toBe('READ');
  });

  it('stores inbound media; only people who can see the ticket can download it', async () => {
    const id = await openPinReset();
    await inbound({
      type: 'document',
      document: { id: 'MEDIA-IN-1', mime_type: 'application/pdf', filename: 'nrc front.pdf' },
    });
    const ticket = await app.ticket(SUP, id);
    const file = ticket!.messages.flatMap((m) => m.attachments)[0];
    expect(file).toMatchObject({ name: 'nrc front.pdf', mimeType: 'application/pdf', scanStatus: 'NOT_SCANNED', available: true });

    const assignee = ticket!.assignedUserId!;
    const other = assignee === AGENT_1.id ? AGENT_2 : AGENT_1;
    const download = await app.attachment(BACK_OFFICE[assignee], file.id);
    expect(download.body.toString()).toBe('%PDF-1.4 fake');
    await expect(app.attachment(other, file.id)).rejects.toBeInstanceOf(ForbiddenException);
    const types = (await prisma.auditEvent.findMany({ where: { ticketId: id } })).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['ATTACHMENT_DOWNLOADED', 'ACCESS_DENIED']));
  });

  it('sends staff files through Meta and refuses types WhatsApp cannot carry', async () => {
    const id = await openPinReset();
    const assignee = (await app.ticket(SUP, id))!.assignedUserId!;
    await expect(
      app.sendMedia(BACK_OFFICE[assignee], id, { buffer: Buffer.from('<html>'), originalname: 'x.html', mimetype: 'text/html' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await app.sendMedia(BACK_OFFICE[assignee], id, { buffer: Buffer.from('%PDF'), originalname: 'form.pdf', mimetype: 'application/pdf' }, 'Please sign');
    await messaging.tick();
    expect(meta.uploads).toEqual(['form.pdf']);
    expect(meta.sent.at(-1)).toMatchObject({
      type: 'document',
      document: { id: 'META-MEDIA-1', caption: 'Please sign', filename: 'form.pdf' },
    });
  });


  it('retries a failed inbound event on request', async () => {
    await messaging.receiveWebhook(webhookFor({ type: 'text', text: { body: 'Hi' } }));
    const event = await prisma.inboundWebhookEvent.findFirstOrThrow();
    await prisma.inboundWebhookEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: 'boom' } });
    expect((await messaging.operations(SUP)).inbound.map((e) => e.id)).toContain(event.id);
    expect((await app.dashboard(SUP)).stuckInbound).toBe(1);
    await messaging.retryInbound(SUP, event.id);
    await messaging.tick();
    expect((await prisma.inboundWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PROCESSED');
  });

  it('detects tampering with the audit chain', async () => {
    await openPinReset();
    const clean = await audits.verify();
    expect(clean.brokenAt).toBeNull();
    expect(clean.checked).toBeGreaterThan(3);
    expect(clean.linkOnly).toBe(0);
    const victim = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: 'PIN_RESET_ROUTED' } });
    await prisma.auditEvent.update({
      where: { id: victim.id },
      data: { metadata: { ...(victim.metadata as object), slaMinutes: 60 } },
    });
    const broken = await audits.verify();
    expect(broken.brokenAt).toBe(victim.id);
    // Put it back so the local database's chain stays intact after the run.
    await prisma.auditEvent.update({
      where: { id: victim.id },
      data: { metadata: victim.metadata as object },
    });
    expect((await audits.verify()).brokenAt).toBeNull();
  });
});
