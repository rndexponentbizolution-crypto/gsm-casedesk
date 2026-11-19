import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';

// These tests run against a real PostgreSQL database and wipe ticket data
// between tests. Refuse to run against anything that is not a local/CI host.
const SAFE_HOSTS = ['localhost', '127.0.0.1', 'postgres'];
const dbHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    return '';
  }
})();
if (!SAFE_HOSTS.includes(dbHost)) {
  throw new Error(
    `Refusing to run database tests against host "${dbHost || '(DATABASE_URL not set)'}". ` +
      'Point DATABASE_URL at a local or CI PostgreSQL that has been migrated and seeded.',
  );
}

const JOSEPH = '+260970000001';
const RUTH = '+260970000002';
const SUP = ['SUPERVISOR', 'demo-supervisor'] as const;

describe('AppController', () => {
  let module: TestingModule;
  let api: AppController;
  let service: AppService;
  let prisma: PrismaService;

  /** Walk the WhatsApp bot through to a routed, assigned PIN reset. */
  const openPinReset = async (phone = JOSEPH) => {
    await api.simulateInbound({ phone, text: 'Hi' });
    await api.simulateInbound({
      phone,
      replyId: 'PIN_RESET',
      text: 'PIN reset',
    });
    const routed = await api.simulateInbound({
      phone,
      text: 'Customer 0971234567, NRC front/back and live photo attached',
    });
    return routed.ticketId!;
  };
  const get = async (id: string) => (await service.ticket(...SUP, id))!;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, PrismaService],
    }).compile();
    await module.init();
    api = module.get(AppController);
    service = module.get(AppService);
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$transaction([
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
    await module.close();
  });

  it('reports simulation health with a live database check', async () => {
    const health = await api.health();
    expect(health.status).toBe('ok');
    expect(health.database).toBe('ok');
  });

  describe('entry bot', () => {
    it('greets a first message with the query-type menu', async () => {
      const result = await api.simulateInbound({ phone: JOSEPH, text: 'Hi' });
      expect(result.reference).toMatch(/^GSM-\d{6}$/);
      expect(result.botState).toBe('MENU');
      const ticket = await get(result.ticketId!);
      expect(ticket.status).toBe('NEW');
      expect(ticket.assignedUserId).toBeNull();
      const bot = ticket.messages.at(-1)!;
      expect(bot.sender).toBe('bot');
      expect((bot.interactive as { options: unknown[] }).options).toHaveLength(
        6,
      );
    });

    it('routes a PIN reset: asks for details, acknowledges, assigns with a 5-minute SLA', async () => {
      const id = await openPinReset();
      const ticket = await get(id);
      expect(ticket.queryType).toBe('PIN_RESET');
      expect(ticket.status).toBe('ASSIGNED');
      expect(ticket.priority).toBe(1);
      expect(ticket.assignedUserId).toMatch(/^demo-agent-/);
      expect(ticket.botState).toBe('WITH_AGENT');
      expect(ticket.details.msisdn).toBe('+260971234567');
      expect(ticket.tags).toEqual(
        expect.arrayContaining([
          'query_pin_reset',
          'sla_5min',
          'priority_high',
        ]),
      );
      const slaMinutes =
        (new Date(ticket.slaDueAt!).getTime() - Date.now()) / 60000;
      expect(slaMinutes).toBeGreaterThan(4);
      expect(slaMinutes).toBeLessThanOrEqual(5);
      expect(ticket.messages.at(-1)!.templateId).toBe('ack-pin-reset');
    });

    it('jumps straight to PIN reset on a trigger phrase', async () => {
      const result = await api.simulateInbound({
        phone: JOSEPH,
        text: 'forgot pin',
      });
      expect(result.botState).toBe('AWAITING_PIN_DETAILS');
    });

    it('redirects other query types to email and closes the ticket', async () => {
      await api.simulateInbound({ phone: RUTH, text: 'Hello' });
      await api.simulateInbound({ phone: RUTH, text: 'Other' });
      const result = await api.simulateInbound({
        phone: RUTH,
        replyId: 'REVERSAL',
      });
      const ticket = await get(result.ticketId!);
      expect(ticket.status).toBe('CLOSED');
      expect(ticket.queryType).toBe('REVERSAL');
      expect(ticket.outcome).toBe('Redirected to email');
      expect(ticket.tags).toContain('redirect_to_email');
      expect(ticket.messages.at(-1)!.body).toContain(
        'gsm.backoffice@exponentbizolution.org',
      );
      expect(result.botState).toBe('IDLE');
    });

    it('re-asks when the reply is not a menu option', async () => {
      await api.simulateInbound({ phone: JOSEPH, text: 'Hi' });
      const result = await api.simulateInbound({
        phone: JOSEPH,
        text: 'banana',
      });
      expect(result.botState).toBe('MENU');
      const ticket = await get(result.ticketId!);
      expect(ticket.messages.at(-1)!.body).toBe(
        'Please select your query type.',
      );
    });

    it('starts a new ticket after the previous one is closed', async () => {
      const first = await openPinReset();
      await api.reply(...SUP, first, {
        text: 'done',
        templateId: 'success-pin-reset',
      });
      const next = await api.simulateInbound({ phone: JOSEPH, text: 'Hi' });
      expect(next.ticketId).not.toBe(first);
      expect(next.botState).toBe('MENU');
    });
  });

  describe('standard responses', () => {
    it('resolve: successful PIN reset records the outcome and frees the conversation', async () => {
      const id = await openPinReset();
      const ticket = await api.reply(...SUP, id, {
        text: 'Your PIN reset request has been processed successfully.',
        templateId: 'success-pin-reset',
      });
      expect(ticket.status).toBe('RESOLVED');
      expect(ticket.outcome).toBe('Successful PIN reset');
      expect(ticket.details.resolved).toBe(true);
      expect(ticket.acknowledgedAt).not.toBeNull();
      expect(ticket.botState).toBe('IDLE');
    });

    it('escalate: records subject, attachments, email and a new SLA', async () => {
      const id = await openPinReset();
      const ticket = await api.reply(...SUP, id, {
        text: 'Above threshold',
        templateId: 'esc-above-threshold',
      });
      expect(ticket.status).toBe('ESCALATED');
      expect(ticket.details.escalation?.subject).toBe(
        'PIN Reset Above Threshold',
      );
      expect(ticket.details.escalation?.attachments).toContain(
        'NRC (front & back)',
      );
      const hours =
        (new Date(ticket.slaDueAt!).getTime() - Date.now()) / 3600_000;
      expect(Math.round(hours)).toBe(24);
    });

    it('pending: waits on the field agent, and their next message re-opens work', async () => {
      const id = await openPinReset();
      const pending = await api.reply(...SUP, id, {
        text: 'Missing NRC',
        templateId: 'doc-missing-live-nrc',
      });
      expect(pending.status).toBe('PENDING_INFORMATION');
      await api.simulateInbound({
        phone: JOSEPH,
        text: 'Here are the NRC photos',
        mediaType: 'image',
      });
      expect((await get(id)).status).toBe('IN_PROGRESS');
    });

    it('refuses replies on closed cases and unknown templates', async () => {
      const id = await openPinReset();
      await expect(
        api.reply(...SUP, id, { text: 'x', templateId: 'nope' }),
      ).rejects.toThrow();
      await api.reply(...SUP, id, {
        text: 'x',
        templateId: 'call-not-answering',
      });
      await expect(api.reply(...SUP, id, { text: 'hello' })).rejects.toThrow();
    });
  });

  describe('casework', () => {
    it('saves log fields and checklists', async () => {
      const id = await openPinReset();
      const ticket = await api.updateCase(...SUP, id, {
        details: {
          nrcNumber: '123456/10/1',
          balanceZmw: 1200,
          validation: { livePhoto: true, nrcFront: true },
        },
      });
      expect(ticket.details.nrcNumber).toBe('123456/10/1');
      expect(ticket.details.balanceZmw).toBe(1200);
      expect(ticket.details.validation).toEqual({
        livePhoto: true,
        nrcFront: true,
      });
      await expect(
        api.updateCase(...SUP, id, { details: { hacked: true } }),
      ).rejects.toThrow();
    });

    it('produces the SOP daily log', async () => {
      const id = await openPinReset();
      await api.reply(...SUP, id, {
        text: 'ok',
        templateId: 'success-pin-reset',
      });
      const csv = await api.dailyLog(...SUP);
      const [header, row] = csv.split('\n');
      expect(header).toContain('"Time of Pickup"');
      expect(row).toContain('"+260971234567"');
      expect(row).toContain('"PIN reset"');
      expect(row).toContain('"Yes"');
    });
  });

  describe('routing & access', () => {
    it('numbers tickets sequentially and threads follow-ups into the open ticket', async () => {
      const first = await api.simulateInbound({ phone: JOSEPH, text: 'Hi' });
      const followUp = await api.simulateInbound({
        phone: JOSEPH,
        text: 'PIN reset',
      });
      const second = await api.simulateInbound({ phone: RUTH, text: 'Hi' });
      expect(followUp.ticketId).toBe(first.ticketId);
      expect(Number(second.reference!.slice(4))).toBe(
        Number(first.reference!.slice(4)) + 1,
      );
    });

    it('balances PIN resets across back-office staff', async () => {
      const a = await openPinReset(JOSEPH);
      const b = await openPinReset(RUTH);
      expect((await get(a)).assignedUserId).not.toBe(
        (await get(b)).assignedUserId,
      );
    });

    it('revokes back-office access after reassignment', async () => {
      const id = await openPinReset();
      const previous = (await get(id)).assignedUserId!;
      const target =
        previous === 'demo-agent-1' ? 'demo-agent-2' : 'demo-agent-1';
      await api.reassign(...SUP, id, { userId: target });
      expect(await service.ticket('BACK_OFFICE', previous, id)).toBeNull();
      expect(await service.ticket('BACK_OFFICE', target, id)).not.toBeNull();
    });

    it('ignores duplicate provider message identifiers', async () => {
      const first = await api.simulateInbound({
        phone: JOSEPH,
        text: 'Hi',
        providerId: 'wamid.test.123',
      });
      const second = await api.simulateInbound({
        phone: JOSEPH,
        text: 'Hi',
        providerId: 'wamid.test.123',
      });
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      const inbound = (await get(first.ticketId!)).messages.filter(
        (message) => message.direction === 'INBOUND',
      );
      expect(inbound).toHaveLength(1);
    });

    it('keeps an unbroken audit hash chain', async () => {
      const id = await openPinReset();
      await api.reply(...SUP, id, { text: 'Reply' });
      const events = await prisma.auditEvent.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(events.length).toBeGreaterThan(5);
      events
        .slice(1)
        .forEach((event, index) =>
          expect(event.previousHash).toBe(events[index].hash),
        );
    });

    it('allows authorised reports and CSV export', async () => {
      await openPinReset();
      const report = await api.reports(...SUP);
      expect(report.ticketsCreated).toBeGreaterThan(0);
      expect(report.byQueryType['PIN reset']).toBe(1);
      expect(await api.reportCsv(...SUP)).toContain('"metric","value"');
      await expect(
        api.reports('BACK_OFFICE', 'demo-agent-1'),
      ).rejects.toThrow();
      await expect(
        api.dailyLog('BACK_OFFICE', 'demo-agent-1'),
      ).rejects.toThrow();
    });

    it('enforces invalid status transitions', async () => {
      const id = await openPinReset(RUTH);
      await expect(
        api.status(...SUP, id, { status: 'CLOSED' }),
      ).rejects.toThrow();
      await expect(
        api.status(...SUP, id, { status: 'IN_PROGRESS' }),
      ).resolves.toBeDefined();
    });
  });
});
