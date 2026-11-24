import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { AppService } from './app.service';
import { AuditService } from './audit.service';
import { KeycloakAdmin } from './keycloak-admin';
import { effectivePermissions } from './permissions';
import { PrismaService } from './prisma.service';
import { ScannerService } from './scanner';
import { StorageService } from './storage';
import {
  ADMIN,
  AGENT_1,
  assertTestDatabase,
  JOSEPH,
  seedFixtures,
  SUP,
} from './test-fixtures.jest';

assertTestDatabase();
delete process.env.S3_BUCKET;
delete process.env.CLAMAV_HOST;

/** Stands in for Keycloak's admin API. */
class FakeKeycloak {
  configured = true;
  users = new Map<string, { email: string; enabled: boolean; password?: string }>();
  logouts: string[] = [];
  private seq = 0;
  createUser(input: { email: string }, password: string) {
    const id = `kc-${++this.seq}-${Date.now()}`;
    this.users.set(id, { email: input.email, enabled: true, password });
    return Promise.resolve(id);
  }
  updateUser(id: string, changes: { enabled?: boolean; email?: string }) {
    Object.assign(this.users.get(id) ?? {}, changes);
    return Promise.resolve();
  }
  logout(id: string) {
    this.logouts.push(id);
    return Promise.resolve();
  }
  resetPassword(id: string, password: string) {
    Object.assign(this.users.get(id) ?? {}, { password });
    return Promise.resolve();
  }
  deleteUser(id: string) {
    this.users.delete(id);
    return Promise.resolve();
  }
}

describe('Administration', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;
  let app: AppService;
  const keycloak = new FakeKeycloak();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [AdminService, AppService, AuditService, PrismaService, ScannerService, StorageService],
    })
      .useMocker((token) => (token === KeycloakAdmin ? keycloak : undefined))
      .compile();
    prisma = module.get(PrismaService);
    admin = module.get(AdminService);
    app = module.get(AppService);
    await prisma.$connect();
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
      prisma.user.deleteMany({ where: { email: { endsWith: '@created.test' } } }),
      prisma.fieldAgent.deleteMany({ where: { phone: { startsWith: '+26099' } } }),
    ]);
    await seedFixtures(prisma);
  });

  afterAll(async () => {
    // Leave only the shared fixtures behind, so other suites route tickets to them.
    await prisma.$transaction([
      prisma.ticketAssignment.deleteMany({ where: { user: { email: { endsWith: '@created.test' } } } }),
      prisma.user.deleteMany({ where: { email: { endsWith: '@created.test' } } }),
      prisma.fieldAgent.deleteMany({ where: { phone: { startsWith: '+26099' } } }),
    ]);
    await module.close();
  });

  it('creates a Keycloak sign-in and a CaseDesk account with a one-time password', async () => {
    const result = await admin.createStaff(ADMIN, {
      name: 'Grace Lungu',
      email: 'Grace@Created.test',
      role: 'BACK_OFFICE',
      grantedPermissions: ['reports.view'],
    });
    expect(result.temporaryPassword).toMatch(/^.{16}$/);
    expect(result.staff).toMatchObject({
      email: 'grace@created.test',
      role: 'BACK_OFFICE',
      permissions: ['tickets.reply', 'reports.view'],
    });
    expect(keycloak.users.get(result.staff.id)?.password).toBe(result.temporaryPassword);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: 'STAFF_ADDED' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(result.temporaryPassword);
  });

  it('refuses duplicate emails, unknown roles and unknown permissions', async () => {
    await admin.createStaff(ADMIN, { name: 'A', email: 'dup@created.test', role: 'BACK_OFFICE' });
    await expect(admin.createStaff(ADMIN, { name: 'B', email: 'dup@created.test', role: 'BACK_OFFICE' })).rejects.toBeInstanceOf(ConflictException);
    await expect(admin.createStaff(ADMIN, { name: 'C', email: 'c@created.test', role: 'ROOT' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      admin.createStaff(ADMIN, { name: 'D', email: 'd@created.test', role: 'BACK_OFFICE', grantedPermissions: ['everything'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only lets people with staff.manage manage staff', async () => {
    await expect(admin.listStaff(SUP)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(admin.createStaff(AGENT_1, { name: 'X', email: 'x@created.test', role: 'ADMINISTRATOR' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('applies per-person revokes: a supervisor without export cannot export', async () => {
    const created = await admin.createStaff(ADMIN, {
      name: 'No Export',
      email: 'noexport@created.test',
      role: 'SUPERVISOR',
      revokedPermissions: ['reports.export'],
    });
    const actor = { id: created.staff.id, permissions: created.staff.permissions };
    await expect(app.reports(actor)).resolves.toBeDefined();
    await expect(app.reportCsv(actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deactivating disables the sign-in and ends their sessions', async () => {
    const created = await admin.createStaff(ADMIN, { name: 'Leaver', email: 'leaver@created.test', role: 'BACK_OFFICE' });
    const result = await admin.updateStaff(ADMIN, created.staff.id, { active: false });
    expect(result.staff.active).toBe(false);
    expect(keycloak.users.get(created.staff.id)?.enabled).toBe(false);
    expect(keycloak.logouts).toContain(created.staff.id);
    expect(await prisma.auditEvent.count({ where: { eventType: 'STAFF_DEACTIVATED' } })).toBe(1);
  });

  it('never lets an administrator lock themselves out', async () => {
    await expect(admin.updateStaff(ADMIN, ADMIN.id, { role: 'SUPERVISOR' })).rejects.toThrow(/your own access/);
    await expect(admin.updateStaff(ADMIN, ADMIN.id, { revokedPermissions: ['staff.manage'] })).rejects.toThrow(/your own access/);
    await expect(admin.updateStaff(ADMIN, ADMIN.id, { active: false })).rejects.toThrow(/your own access/);
  });

  it('never leaves nobody able to manage staff', async () => {
    const second = await admin.createStaff(ADMIN, { name: 'Second Admin', email: 'second@created.test', role: 'ADMINISTRATOR' });
    const actor = { id: second.staff.id, permissions: second.staff.permissions };
    // With two administrators, one may demote the other...
    await admin.updateStaff(actor, ADMIN.id, { role: 'SUPERVISOR' });
    // ...but not once only they are left.
    await expect(admin.updateStaff({ ...ADMIN, permissions: effectivePermissions('ADMINISTRATOR') }, second.staff.id, { active: false })).rejects.toThrow(
      /At least one active person/,
    );
    await prisma.user.update({ where: { keycloakId: ADMIN.id }, data: { role: 'ADMINISTRATOR' } });
  });

  it('resets a password to a new one-time password and signs them out', async () => {
    const created = await admin.createStaff(ADMIN, { name: 'Forgetful', email: 'forgot@created.test', role: 'BACK_OFFICE' });
    const reset = await admin.resetPassword(ADMIN, created.staff.id);
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);
    expect(keycloak.users.get(created.staff.id)?.password).toBe(reset.temporaryPassword);
    expect(keycloak.logouts).toContain(created.staff.id);
  });

  it('adds and edits field agents, with phone validation', async () => {
    await expect(admin.createFieldAgent(AGENT_1, { name: 'Nope', phone: '+260990000001' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(admin.createFieldAgent(ADMIN, { name: 'Bad Number', phone: '0971234567' })).rejects.toThrow(/international format/);
    const agent = await admin.createFieldAgent(ADMIN, { name: 'New Agent', phone: '+260 99 000 0001', region: 'Lusaka' });
    expect(agent.phone).toBe('+260990000001');
    await expect(admin.createFieldAgent(ADMIN, { name: 'Twin', phone: '+260990000001' })).rejects.toBeInstanceOf(ConflictException);
    const updated = await admin.updateFieldAgent(ADMIN, agent.id, { active: false, storeName: 'Kabwe Container' });
    expect(updated).toMatchObject({ active: false, storeName: 'Kabwe Container' });
  });

  it("won't change the number of an agent who already has conversations", async () => {
    await app.handleInbound({ phone: JOSEPH, text: 'Hi' }, true);
    const agent = await prisma.fieldAgent.findUniqueOrThrow({ where: { phone: JOSEPH } });
    await expect(admin.updateFieldAgent(ADMIN, agent.id, { phone: '+260990000009' })).rejects.toThrow(/already has WhatsApp conversations/);
  });

  it('refuses to reassign a ticket to someone who cannot work tickets', async () => {
    const created = await admin.createStaff(ADMIN, {
      name: 'Read Only',
      email: 'readonly@created.test',
      role: 'BACK_OFFICE',
      revokedPermissions: ['tickets.reply'],
    });
    const { ticketId } = await app.handleInbound({ phone: JOSEPH, text: 'Hi' }, true);
    await expect(app.reassign(SUP, ticketId!, created.staff.id)).rejects.toThrow(/cannot|can work tickets/);
  });
});
