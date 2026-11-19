import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

const DEFAULT_TEAM = 'Zambia Field Support';
const CLOSED_STATES: TicketStatus[] = ['RESOLVED', 'CLOSED'];
const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };
// Serialises writers to the audit hash chain (and ticket reference numbering).
const AUDIT_LOCK_KEY = 7342001;

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  UNASSIGNED: ['ASSIGNED', 'ESCALATED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['PENDING_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_INFORMATION: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
};

const ticketInclude = {
  conversation: { include: { contact: { include: { fieldAgent: true } } } },
  team: true,
  assignments: {
    where: { active: true },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  },
  messages: { orderBy: { createdAt: 'asc' } },
  auditEvents: { orderBy: { createdAt: 'asc' }, include: { actor: true } },
} satisfies Prisma.TicketInclude;

type TicketRecord = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export interface Ticket {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: number;
  assignedUserId: string | null;
  team: string;
  region: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lastMessageAt: string;
  agent: { id: string; name: string; phone: string };
  messages: Array<{
    id: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
    body: string;
    state: string;
    simulated: boolean;
    createdAt: string;
  }>;
  audit: Array<{
    id: string;
    type: string;
    actor: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
}

const isPrivileged = (role: string) =>
  role === 'SUPERVISOR' || role === 'ADMINISTRATOR';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- mapping & access ----------

  private toDto(record: TicketRecord): Ticket {
    const agent = record.conversation.contact.fieldAgent;
    const assignee = record.assignments[0]?.user ?? null;
    return {
      id: record.id,
      reference: record.reference,
      subject: record.subject,
      status: record.status,
      priority: record.priority,
      assignedUserId: assignee?.keycloakId ?? null,
      team: record.team?.name ?? DEFAULT_TEAM,
      region: agent.region ?? record.team?.region ?? '',
      firstResponseAt: record.firstResponseAt?.toISOString() ?? null,
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      lastMessageAt: record.lastMessageAt.toISOString(),
      agent: { id: agent.id, name: agent.name, phone: agent.phone },
      messages: record.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body ?? '',
        state: message.state,
        simulated: message.isSimulated,
        createdAt: message.createdAt.toISOString(),
      })),
      audit: record.auditEvents.map((event) => {
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        return {
          id: event.id,
          type: event.eventType,
          actor:
            event.actor?.keycloakId ??
            (typeof metadata.actor === 'string' ? metadata.actor : 'system'),
          createdAt: event.createdAt.toISOString(),
          metadata,
        };
      }),
    };
  }

  private visibilityWhere(role: string, user: string): Prisma.TicketWhereInput {
    if (isPrivileged(role)) return {};
    return {
      assignments: { some: { active: true, user: { keycloakId: user } } },
    };
  }

  private authorised(role: string, user: string, ticket: Ticket) {
    return isPrivileged(role) || ticket.assignedUserId === user;
  }

  private async loadTicket(id: string, db: Tx | PrismaService = this.prisma) {
    return db.ticket.findUnique({ where: { id }, include: ticketInclude });
  }

  private async loadAuthorised(role: string, user: string, id: string) {
    const record = await this.loadTicket(id);
    if (!record) throw new NotFoundException('Ticket not found');
    const ticket = this.toDto(record);
    if (!this.authorised(role, user, ticket))
      throw new ForbiddenException('Not authorised');
    return ticket;
  }

  private async visible(
    role: string,
    user: string,
    extra: Prisma.TicketWhereInput = {},
  ) {
    const records = await this.prisma.ticket.findMany({
      where: { AND: [this.visibilityWhere(role, user), extra] },
      include: ticketInclude,
      orderBy: { lastMessageAt: 'desc' },
    });
    return records.map((record) => this.toDto(record));
  }

  private async backOfficeUsers() {
    return this.prisma.user.findMany({
      where: { role: 'BACK_OFFICE', active: true },
      orderBy: { keycloakId: 'asc' },
    });
  }

  // ---------- audit chain ----------

  private async lockChain(tx: Tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  }

  private async audit(
    tx: Tx,
    ticketId: string | null,
    actor: string,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    const actorUser =
      actor === 'system'
        ? null
        : await tx.user.findUnique({ where: { keycloakId: actor } });
    const previous = await tx.auditEvent.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { hash: true, createdAt: true },
    });
    // Keep the chain strictly time-ordered so "latest" is unambiguous.
    let createdAt = new Date();
    if (previous && createdAt.getTime() <= previous.createdAt.getTime())
      createdAt = new Date(previous.createdAt.getTime() + 1);
    const payload = { ...metadata, actor };
    const hash = createHash('sha256')
      .update(
        `${previous?.hash ?? ''}|${actor}|${type}|${JSON.stringify(payload)}|${ticketId ?? ''}|${createdAt.toISOString()}`,
      )
      .digest('hex');
    await tx.auditEvent.create({
      data: {
        ticketId,
        actorId: actorUser?.id ?? null,
        eventType: type,
        metadata: payload as Prisma.InputJsonValue,
        hash,
        previousHash: previous?.hash ?? null,
        createdAt,
      },
    });
  }

  private async recordStatus(
    tx: Tx,
    ticketId: string,
    from: TicketStatus | null,
    to: TicketStatus,
    actor: string,
    reason?: string,
  ) {
    const actorUser =
      actor === 'system'
        ? null
        : await tx.user.findUnique({ where: { keycloakId: actor } });
    await tx.ticketStatusHistory.create({
      data: {
        ticketId,
        fromStatus: from,
        toStatus: to,
        actorId: actorUser?.id ?? null,
        reason,
      },
    });
  }

  // ---------- routing ----------

  private async assignLeastLoaded(tx: Tx, teamId: string) {
    const eligible = await tx.user.findMany({
      where: { role: 'BACK_OFFICE', active: true, availability: true, teamId },
      orderBy: { keycloakId: 'asc' },
    });
    if (!eligible.length) return null;
    const loads = await Promise.all(
      eligible.map(async (user) => ({
        user,
        load: await tx.ticketAssignment.count({
          where: {
            userId: user.id,
            active: true,
            ticket: { status: { notIn: CLOSED_STATES } },
          },
        }),
      })),
    );
    loads.sort(
      (a, b) =>
        a.load - b.load || a.user.keycloakId.localeCompare(b.user.keycloakId),
    );
    return loads[0].user;
  }

  private async nextReference(tx: Tx) {
    const latest = await tx.ticket.findFirst({
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = latest
      ? Number(latest.reference.replace(/^GSM-/, '')) || 0
      : 0;
    return `GSM-${String(current + 1).padStart(6, '0')}`;
  }

  // ---------- queries ----------

  async databaseReachable() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async dashboard(role: string, user: string) {
    const [visible, staff] = await Promise.all([
      this.visible(role, user),
      this.backOfficeUsers(),
    ]);
    const counts = (status: TicketStatus) =>
      visible.filter((ticket) => ticket.status === status).length;
    const isOpen = (ticket: Ticket) => !CLOSED_STATES.includes(ticket.status);
    return {
      total: visible.length,
      new: counts('NEW'),
      open: visible.filter(isOpen).length,
      unassigned: counts('UNASSIGNED'),
      assigned: counts('ASSIGNED'),
      escalated: counts('ESCALATED'),
      resolved: counts('RESOLVED'),
      failedOutbound: visible
        .flatMap((ticket) => ticket.messages)
        .filter((message) => message.state === 'FAILED').length,
      stuckInbound: 0,
      workload: staff.map((item) => ({
        id: item.keycloakId,
        name: item.name,
        available: item.availability,
        capacity: item.capacity,
        activeTickets: visible.filter(
          (ticket) =>
            ticket.assignedUserId === item.keycloakId && isOpen(ticket),
        ).length,
      })),
    };
  }

  async tickets(role: string, user: string, status?: string) {
    if (status && !(status in TRANSITIONS))
      throw new BadRequestException(`Unknown status: ${status}`);
    const [visible, staff] = await Promise.all([
      this.visible(
        role,
        user,
        status ? { status: status as TicketStatus } : {},
      ),
      this.prisma.user.findMany({ select: { keycloakId: true, name: true } }),
    ]);
    const names = new Map(staff.map((item) => [item.keycloakId, item.name]));
    return visible.map((ticket) => ({
      ...ticket,
      unread:
        ticket.messages.filter((message) => message.direction === 'INBOUND')
          .length % 3,
      assignee:
        (ticket.assignedUserId && names.get(ticket.assignedUserId)) ||
        'Unassigned',
    }));
  }

  async ticket(role: string, user: string, id: string): Promise<Ticket | null> {
    const record = await this.loadTicket(id);
    if (!record) return null;
    const ticket = this.toDto(record);
    return this.authorised(role, user, ticket) ? ticket : null;
  }

  async fieldAgents() {
    const agents = await this.prisma.fieldAgent.findMany({
      where: { active: true },
      orderBy: { employeeId: 'asc' },
    });
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      region: agent.region,
      employeeId: agent.employeeId,
      active: agent.active,
    }));
  }

  // ---------- commands ----------

  async reply(role: string, user: string, id: string, text?: string) {
    const ticket = await this.loadAuthorised(role, user, id);
    if (!text?.trim()) throw new BadRequestException('Reply text is required');
    await this.prisma.$transaction(async (tx) => {
      await this.lockChain(tx);
      const now = new Date();
      await tx.message.create({
        data: {
          ticketId: ticket.id,
          conversationId: (
            await tx.ticket.findUniqueOrThrow({
              where: { id },
              select: { conversationId: true },
            })
          ).conversationId,
          direction: 'OUTBOUND',
          body: text.trim(),
          state: 'SENT',
          isSimulated: true,
          createdAt: now,
        },
      });
      const nextStatus: TicketStatus =
        ticket.status === 'ASSIGNED' ? 'IN_PROGRESS' : ticket.status;
      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
          firstResponseAt: ticket.firstResponseAt ? undefined : now,
          status: nextStatus,
        },
      });
      if (nextStatus !== ticket.status)
        await this.recordStatus(
          tx,
          id,
          ticket.status,
          nextStatus,
          user,
          'First reply',
        );
      await this.audit(tx, id, user, 'REPLY_SUBMITTED', { simulated: true });
      await this.audit(tx, id, user, 'MESSAGE_SENT', {
        provider: 'simulation',
      });
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  async reassign(role: string, user: string, id: string, userId: string) {
    if (!isPrivileged(role))
      throw new ForbiddenException('Supervisor authorisation required');
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const target = await this.prisma.user.findFirst({
      where: { keycloakId: userId, role: 'BACK_OFFICE', active: true },
    });
    if (!target)
      throw new BadRequestException(
        'Reassignment target is not an active back-office employee',
      );
    if (!target.availability)
      throw new BadRequestException('Reassignment target is unavailable');
    await this.prisma.$transaction(async (tx) => {
      await this.lockChain(tx);
      const previous = await tx.ticketAssignment.findFirst({
        where: { ticketId: id, active: true },
        include: { user: true },
      });
      await tx.ticketAssignment.updateMany({
        where: { ticketId: id, active: true },
        data: { active: false },
      });
      await tx.ticketAssignment.create({
        data: {
          ticketId: id,
          userId: target.id,
          reason: 'SUPERVISOR_REASSIGNMENT',
        },
      });
      await tx.ticket.update({ where: { id }, data: { status: 'ASSIGNED' } });
      if (ticket.status !== 'ASSIGNED')
        await this.recordStatus(
          tx,
          id,
          ticket.status,
          'ASSIGNED',
          user,
          'Reassigned',
        );
      await this.audit(tx, id, user, 'TICKET_REASSIGNED', {
        from: previous?.user.keycloakId ?? null,
        to: userId,
      });
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  async changeStatus(role: string, user: string, id: string, status: string) {
    const ticket = await this.loadAuthorised(role, user, id);
    if (!(status in TRANSITIONS))
      throw new BadRequestException(`Unknown status: ${status}`);
    const to = status as TicketStatus;
    if (!TRANSITIONS[ticket.status].includes(to)) {
      throw new BadRequestException(
        `Invalid status transition: ${ticket.status} to ${to}`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockChain(tx);
      const now = new Date();
      await tx.ticket.update({
        where: { id },
        data: {
          status: to,
          resolvedAt: to === 'RESOLVED' && !ticket.resolvedAt ? now : undefined,
          closedAt: to === 'CLOSED' ? now : undefined,
        },
      });
      await this.recordStatus(tx, id, ticket.status, to, user);
      await this.audit(
        tx,
        id,
        user,
        to === 'RESOLVED' ? 'TICKET_RESOLVED' : 'TICKET_STATUS_CHANGED',
        { from: ticket.status, to },
      );
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  async simulateInbound(body: {
    phone: string;
    text?: string;
    mediaType?: string;
    duplicate?: boolean;
    providerId?: string;
  }) {
    const agent = await this.prisma.fieldAgent.findFirst({
      where: { phone: body.phone, active: true },
    });
    if (!agent)
      throw new BadRequestException(
        'Phone number is not a registered field agent',
      );
    const providerId =
      body.providerId ??
      (body.duplicate ? 'duplicate-preserved-id' : `sim-${randomUUID()}`);

    return this.prisma.$transaction(async (tx) => {
      await this.lockChain(tx);

      const contact = await tx.whatsAppContact.upsert({
        where: { phone: agent.phone },
        update: {},
        create: { phone: agent.phone, fieldAgentId: agent.id },
      });
      const conversation = await tx.conversation.upsert({
        where: { contactId: contact.id },
        update: {},
        create: { contactId: contact.id },
      });
      let ticket = await tx.ticket.findFirst({
        where: {
          conversationId: conversation.id,
          status: { notIn: CLOSED_STATES },
        },
        orderBy: { createdAt: 'desc' },
      });

      const seen = await tx.message.findUnique({ where: { providerId } });
      if (seen) {
        if (ticket)
          await this.audit(
            tx,
            ticket.id,
            'system',
            'DUPLICATE_WEBHOOK_IGNORED',
            { providerId, simulated: true },
          );
        return {
          ticketId: ticket?.id ?? null,
          reference: ticket?.reference ?? null,
          providerId,
          duplicate: true,
        };
      }

      if (!body.duplicate && !ticket) {
        const team = await tx.team.upsert({
          where: { name: DEFAULT_TEAM },
          update: {},
          create: { name: DEFAULT_TEAM, region: 'Zambia' },
        });
        const assignee = await this.assignLeastLoaded(tx, team.id);
        ticket = await tx.ticket.create({
          data: {
            reference: await this.nextReference(tx),
            conversationId: conversation.id,
            teamId: team.id,
            subject:
              body.text?.slice(0, 80) ??
              `${body.mediaType ?? 'Media'} attachment`,
            status: assignee ? 'ASSIGNED' : 'UNASSIGNED',
            priority: 2,
          },
        });
        await this.recordStatus(
          tx,
          ticket.id,
          null,
          ticket.status,
          'system',
          'Created from inbound message',
        );
        await this.audit(tx, ticket.id, 'system', 'TICKET_CREATED', {
          routing: assignee ? 'HYBRID_LEAST_LOADED' : 'UNASSIGNED',
        });
        if (assignee) {
          await tx.ticketAssignment.create({
            data: {
              ticketId: ticket.id,
              userId: assignee.id,
              reason: 'HYBRID_LEAST_LOADED',
            },
          });
          await this.audit(tx, ticket.id, 'system', 'TICKET_ASSIGNED', {
            userId: assignee.keycloakId,
          });
        }
      }
      if (!ticket) throw new BadRequestException('Unable to associate ticket');

      const now = new Date();
      await tx.message.create({
        data: {
          providerId,
          ticketId: ticket.id,
          conversationId: conversation.id,
          direction: 'INBOUND',
          body:
            body.text ??
            `[SIMULATED ${body.mediaType?.toUpperCase() ?? 'MEDIA'} ATTACHMENT]`,
          state: 'DELIVERED',
          isSimulated: true,
          createdAt: now,
        },
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: now },
      });
      await this.audit(tx, ticket.id, 'system', 'MESSAGE_RECEIVED', {
        providerId,
        duplicate: Boolean(body.duplicate),
        simulated: true,
      });
      return {
        ticketId: ticket.id,
        reference: ticket.reference,
        providerId,
        duplicate: Boolean(body.duplicate),
      };
    }, TX_OPTIONS);
  }

  // ---------- reporting ----------

  async reports(role: string, user: string) {
    if (!isPrivileged(role))
      throw new ForbiddenException('Supervisor authorisation required');
    const [visible, staff] = await Promise.all([
      this.visible(role, user),
      this.backOfficeUsers(),
    ]);
    const allMessages = visible.flatMap((ticket) => ticket.messages);
    const inbound = allMessages.filter(
      (message) => message.direction === 'INBOUND',
    );
    const outbound = allMessages.filter(
      (message) => message.direction === 'OUTBOUND',
    );
    const minutesBetween = (from: string, to: string) =>
      (new Date(to).getTime() - new Date(from).getTime()) / 60000;
    const responseSamples = visible
      .filter((ticket) => ticket.firstResponseAt)
      .map((ticket) =>
        minutesBetween(ticket.createdAt, ticket.firstResponseAt!),
      );
    const resolutionSamples = visible
      .filter((ticket) => ticket.resolvedAt)
      .map((ticket) => minutesBetween(ticket.createdAt, ticket.resolvedAt!));
    // One decimal place: whole-minute rounding hid sub-minute responses as 0.
    const average = (values: number[]) =>
      values.length
        ? Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) *
              10,
          ) / 10
        : 0;
    const byDate = (messages: Ticket['messages']) =>
      messages.reduce<Record<string, number>>((result, message) => {
        const date = message.createdAt.slice(0, 10);
        result[date] = (result[date] ?? 0) + 1;
        return result;
      }, {});
    return {
      ticketsCreated: visible.length,
      ticketsResolved: visible.filter((ticket) =>
        CLOSED_STATES.includes(ticket.status),
      ).length,
      ticketsOpen: visible.filter(
        (ticket) => !CLOSED_STATES.includes(ticket.status),
      ).length,
      inboundMessages: inbound.length,
      outboundMessages: outbound.length,
      failedOutboundMessages: outbound.filter(
        (message) => message.state === 'FAILED',
      ).length,
      averageFirstResponseMinutes: average(responseSamples),
      averageResolutionMinutes: average(resolutionSamples),
      escalations: visible.filter((ticket) => ticket.status === 'ESCALATED')
        .length,
      unassignedCases: visible.filter(
        (ticket) => ticket.status === 'UNASSIGNED',
      ).length,
      assignmentDistribution: staff.map((item) => ({
        name: item.name,
        tickets: visible.filter(
          (ticket) => ticket.assignedUserId === item.keycloakId,
        ).length,
      })),
      casesByRegion: visible.reduce<Record<string, number>>(
        (result, ticket) => {
          result[ticket.region] = (result[ticket.region] ?? 0) + 1;
          return result;
        },
        {},
      ),
      inboundByDate: byDate(inbound),
      outboundByDate: byDate(outbound),
    };
  }

  async reportCsv(role: string, user: string) {
    const report = await this.reports(role, user);
    const rows = [
      ['metric', 'value'],
      ...Object.entries(report)
        .filter(([, value]) => typeof value === 'number')
        .map(([metric, value]) => [metric, String(value)]),
      [
        'assignment_distribution',
        JSON.stringify(report.assignmentDistribution),
      ],
      ['cases_by_region', JSON.stringify(report.casesByRegion)],
      ['inbound_by_date', JSON.stringify(report.inboundByDate)],
      ['outbound_by_date', JSON.stringify(report.outboundByDate)],
    ];
    return rows
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','),
      )
      .join('\n');
  }
}
