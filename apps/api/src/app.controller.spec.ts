import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  it('reports simulation health', () => {
    expect(appController.health().status).toBe('ok');
  });

  it('creates and assigns a synthetic ticket', () => {
    const result = appController.simulateInbound({
      phone: '+260970000001',
      text: 'Test network issue',
    });
    expect(result.reference).toMatch(/^GSM-\d{6}$/);
  });

  it('revokes back-office access after reassignment', () => {
    const result = appController.simulateInbound({ phone: '+260970000001', text: 'Access test' });
    appController.reassign(
      'SUPERVISOR',
      'demo-supervisor',
      result.ticketId,
      { userId: 'demo-agent-2' },
    );
    expect(appService.ticket('BACK_OFFICE', 'demo-agent-1', result.ticketId)).toBeNull();
  });

  it('ignores duplicate provider message identifiers', () => {
    const first = appController.simulateInbound({
      phone: '+260970000001',
      text: 'Duplicate provider test',
      providerId: 'wamid.test.123',
    });
    const second = appController.simulateInbound({
      phone: '+260970000001',
      text: 'Duplicate provider test',
      providerId: 'wamid.test.123',
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(appService.ticket('SUPERVISOR', 'demo-supervisor', first.ticketId)?.messages.length).toBe(1);
  });

  it('allows authorised reports and CSV export', () => {
    appController.simulateInbound({ phone: '+260970000001', text: 'Report test' });
    expect(appController.reports('SUPERVISOR', 'demo-supervisor').ticketsCreated).toBeGreaterThan(0);
    expect(appController.reportCsv('SUPERVISOR', 'demo-supervisor')).toContain('"metric","value"');
    expect(() => appController.reports('BACK_OFFICE', 'demo-agent-1')).toThrow();
  });

  it('enforces invalid status transitions', () => {
    const result = appController.simulateInbound({ phone: '+260970000002', text: 'Status test' });
    expect(() => appController.status(
      'SUPERVISOR',
      'demo-supervisor',
      result.ticketId,
      { status: 'CLOSED' },
    )).toThrow();
    expect(() => appController.status(
      'SUPERVISOR',
      'demo-supervisor',
      result.ticketId,
      { status: 'IN_PROGRESS' },
    )).not.toThrow();
  });
});
