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

describe('AppController', () => {
  let module: TestingModule;
  let appController: AppController;
  let appService: AppService;
  let prisma: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, PrismaService],
    }).compile();
    await module.init();
    appController = module.get(AppController);
    appService = module.get(AppService);
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

  it('reports simulation health', () => {
    expect(appController.health().status).toBe('ok');
  });

  it('creates, assigns and persists a synthetic ticket', async () => {
    const result = await appController.simulateInbound({ phone: '+260970000001', text: 'Test network issue' });
    expect(result.reference).toMatch(/^GSM-\d{6}$/);
    const stored = await prisma.ticket.findUnique({ where: { id: result.ticketId! }, include: { assignments: true, messages: true } });
    expect(stored?.status).toBe('ASSIGNED');
    expect(stored?.assignments).toHaveLength(1);
    expect(stored?.messages).toHaveLength(1);
  });

  it('numbers tickets sequentially and threads follow-ups into the open ticket', async () => {
    const first = await appController.simulateInbound({ phone: '+260970000001', text: 'One' });
    const followUp = await appController.simulateInbound({ phone: '+260970000001', text: 'Two' });
    const second = await appController.simulateInbound({ phone: '+260970000002', text: 'Three' });
    expect(followUp.ticketId).toBe(first.ticketId);
    expect(Number(second.reference!.slice(4))).toBe(Number(first.reference!.slice(4)) + 1);
  });

  it('balances new tickets across back-office staff', async () => {
    const a = await appController.simulateInbound({ phone: '+260970000001', text: 'A' });
    const b = await appController.simulateInbound({ phone: '+260970000002', text: 'B' });
    const ticketA = await appService.ticket('SUPERVISOR', 'demo-supervisor', a.ticketId!);
    const ticketB = await appService.ticket('SUPERVISOR', 'demo-supervisor', b.ticketId!);
    expect(ticketA?.assignedUserId).not.toBe(ticketB?.assignedUserId);
  });

  it('revokes back-office access after reassignment', async () => {
    const result = await appController.simulateInbound({ phone: '+260970000001', text: 'Access test' });
    const before = await appService.ticket('SUPERVISOR', 'demo-supervisor', result.ticketId!);
    const target = before?.assignedUserId === 'demo-agent-1' ? 'demo-agent-2' : 'demo-agent-1';
    const previous = before!.assignedUserId!;
    await appController.reassign('SUPERVISOR', 'demo-supervisor', result.ticketId!, { userId: target });
    expect(await appService.ticket('BACK_OFFICE', previous, result.ticketId!)).toBeNull();
    expect(await appService.ticket('BACK_OFFICE', target, result.ticketId!)).not.toBeNull();
  });

  it('ignores duplicate provider message identifiers', async () => {
    const first = await appController.simulateInbound({ phone: '+260970000001', text: 'Duplicate provider test', providerId: 'wamid.test.123' });
    const second = await appController.simulateInbound({ phone: '+260970000001', text: 'Duplicate provider test', providerId: 'wamid.test.123' });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((await appService.ticket('SUPERVISOR', 'demo-supervisor', first.ticketId!))?.messages).toHaveLength(1);
  });

  it('records replies, first response time and status history', async () => {
    const result = await appController.simulateInbound({ phone: '+260970000001', text: 'Reply test' });
    const replied = await appController.reply('SUPERVISOR', 'demo-supervisor', result.ticketId!, { text: 'On it' });
    expect(replied.status).toBe('IN_PROGRESS');
    expect(replied.firstResponseAt).not.toBeNull();
    expect(replied.messages.map((message) => message.direction)).toEqual(['INBOUND', 'OUTBOUND']);
    const history = await prisma.ticketStatusHistory.findMany({ where: { ticketId: result.ticketId! }, orderBy: { createdAt: 'asc' } });
    expect(history.map((entry) => entry.toStatus)).toEqual(['ASSIGNED', 'IN_PROGRESS']);
  });

  it('keeps an unbroken audit hash chain', async () => {
    const result = await appController.simulateInbound({ phone: '+260970000001', text: 'Audit test' });
    await appController.reply('SUPERVISOR', 'demo-supervisor', result.ticketId!, { text: 'Reply' });
    const events = await prisma.auditEvent.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(events.length).toBeGreaterThan(3);
    events.slice(1).forEach((event, index) => expect(event.previousHash).toBe(events[index].hash));
  });

  it('allows authorised reports and CSV export', async () => {
    await appController.simulateInbound({ phone: '+260970000001', text: 'Report test' });
    expect((await appController.reports('SUPERVISOR', 'demo-supervisor')).ticketsCreated).toBeGreaterThan(0);
    expect(await appController.reportCsv('SUPERVISOR', 'demo-supervisor')).toContain('"metric","value"');
    await expect(appController.reports('BACK_OFFICE', 'demo-agent-1')).rejects.toThrow();
  });

  it('enforces invalid status transitions', async () => {
    const result = await appController.simulateInbound({ phone: '+260970000002', text: 'Status test' });
    await expect(appController.status('SUPERVISOR', 'demo-supervisor', result.ticketId!, { status: 'CLOSED' })).rejects.toThrow();
    await expect(appController.status('SUPERVISOR', 'demo-supervisor', result.ticketId!, { status: 'IN_PROGRESS' })).resolves.toBeDefined();
  });
});
