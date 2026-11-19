import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

type Role = 'BACK_OFFICE' | 'SUPERVISOR' | 'ADMINISTRATOR';
type TicketStatus = 'NEW' | 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'PENDING_INFORMATION' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

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
  messages: Array<{ id: string; direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL'; body: string; state: string; simulated: boolean; createdAt: string }>;
  audit: Array<{ id: string; type: string; actor: string; createdAt: string; metadata: Record<string, unknown> }>;
}

@Injectable()
export class AppService {
  private serial = 1;
  private ticketStore: Ticket[] = [];
  private providerMessageIds = new Set<string>();
  private users = [
    { id: 'demo-agent-1', name: 'Martha Banda', role: 'BACK_OFFICE' as Role, team: 'Zambia Field Support', available: true, capacity: 20 },
    { id: 'demo-agent-2', name: 'Peter Mulenga', role: 'BACK_OFFICE' as Role, team: 'Zambia Field Support', available: true, capacity: 20 },
    { id: 'demo-supervisor', name: 'Chanda Mwansa', role: 'SUPERVISOR' as Role, team: 'Zambia Field Support', available: true, capacity: 20 },
  ];
  private agents = [
    { id: 'fa-1', name: 'Joseph Tembo', phone: '+260970000001', region: 'Lusaka', employeeId: 'FA-001', active: true },
    { id: 'fa-2', name: 'Ruth Phiri', phone: '+260970000002', region: 'Copperbelt', employeeId: 'FA-002', active: true },
  ];
  private previousAuditHash = '';

  private audit(ticket: Ticket | undefined, actor: string, type: string, metadata: Record<string, unknown> = {}) {
    const hash = createHash('sha256').update(`${this.previousAuditHash}|${actor}|${type}|${JSON.stringify(metadata)}|${ticket?.id ?? ''}|${new Date().toISOString()}`).digest('hex');
    this.previousAuditHash = hash;
    const event = { id: randomUUID(), type, actor, createdAt: new Date().toISOString(), metadata };
    ticket?.audit.push(event);
  }

  private authorised(role: Role, userId: string, ticket: Ticket) {
    if (role === 'SUPERVISOR' || role === 'ADMINISTRATOR') return true;
    return ticket.assignedUserId === userId;
  }

  private assignLeastLoaded(team: string): string | null {
    const eligible = this.users.filter((user) => user.role === 'BACK_OFFICE' && user.available && user.team === team);
    if (!eligible.length) return null;
    const workload = (id: string) => this.ticketStore.filter((ticket) => ticket.assignedUserId === id && !['RESOLVED', 'CLOSED'].includes(ticket.status)).length;
    eligible.sort((a, b) => workload(a.id) - workload(b.id) || a.id.localeCompare(b.id));
    return eligible[0].id;
  }

  dashboard(role: string, user: string) {
    const visible = this.visible(role, user);
    const counts = (status: TicketStatus) => visible.filter((ticket) => ticket.status === status).length;
    const failed = visible.flatMap((ticket) => ticket.messages).filter((message) => message.state === 'FAILED').length;
    return {
      total: visible.length,
      new: counts('NEW'),
      open: visible.filter((ticket) => !['RESOLVED', 'CLOSED'].includes(ticket.status)).length,
      unassigned: counts('UNASSIGNED'),
      assigned: counts('ASSIGNED'),
      escalated: counts('ESCALATED'),
      resolved: counts('RESOLVED'),
      failedOutbound: failed,
      stuckInbound: 0,
      workload: this.users.filter((item) => item.role === 'BACK_OFFICE').map((item) => ({
        id: item.id,
        name: item.name,
        available: item.available,
        activeTickets: visible.filter((ticket) => ticket.assignedUserId === item.id && !['RESOLVED', 'CLOSED'].includes(ticket.status)).length,
      })),
    };
  }

  visible(role: string, user: string) {
    if (role === 'SUPERVISOR' || role === 'ADMINISTRATOR') return this.ticketStore;
    return this.ticketStore.filter((ticket) => ticket.assignedUserId === user);
  }

  tickets(role: string, user: string, status?: string) {
    const visible = this.visible(role, user);
    return visible.filter((ticket) => !status || ticket.status === status).map((ticket) => ({
      ...ticket,
      unread: ticket.messages.filter((message) => message.direction === 'INBOUND').length % 3,
      assignee: this.users.find((item) => item.id === ticket.assignedUserId)?.name ?? 'Unassigned',
    }));
  }

  ticket(role: string, user: string, id: string) {
    const found = this.ticketStore.find((item) => item.id === id);
    return found && this.authorised(role as Role, user, found) ? found : null;
  }

  reply(role: string, user: string, id: string, text?: string) {
    const ticket = this.ticketStore.find((item) => item.id === id);
    if (!ticket) throw new Error('Ticket not found');
    if (!this.authorised(role as Role, user, ticket)) throw new Error('Not authorised');
    if (!text?.trim()) throw new Error('Reply text is required');
    const now = new Date().toISOString();
    ticket.messages.push({ id: randomUUID(), direction: 'OUTBOUND', body: text.trim(), state: 'SENT', simulated: true, createdAt: now });
    ticket.lastMessageAt = now;
    ticket.firstResponseAt ??= now;
    ticket.status = ticket.status === 'ASSIGNED' ? 'IN_PROGRESS' : ticket.status;
    this.audit(ticket, user, 'REPLY_SUBMITTED', { simulated: true });
    this.audit(ticket, user, 'MESSAGE_SENT', { provider: 'simulation' });
    return ticket;
  }

  reassign(role: string, user: string, id: string, userId: string) {
    if (role !== 'SUPERVISOR' && role !== 'ADMINISTRATOR') throw new Error('Supervisor authorisation required');
    const ticket = this.ticketStore.find((item) => item.id === id);
    if (!ticket) throw new Error('Ticket not found');
    const target = this.users.find((item) => item.id === userId && item.role === 'BACK_OFFICE');
    if (!target) throw new Error('Reassignment target is not an active back-office employee');
    if (!target.available) throw new Error('Reassignment target is unavailable');
    const from = ticket.assignedUserId;
    ticket.assignedUserId = userId;
    ticket.status = 'ASSIGNED';
    this.audit(ticket, user, 'TICKET_REASSIGNED', { from, to: userId });
    return ticket;
  }

  changeStatus(role: string, user: string, id: string, status: string) {
    const ticket = this.ticketStore.find((item) => item.id === id);
    if (!ticket) throw new Error('Ticket not found');
    if (!this.authorised(role as Role, user, ticket)) throw new Error('Not authorised');
    const transitions: Record<TicketStatus, TicketStatus[]> = {
      NEW: ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'],
      UNASSIGNED: ['ASSIGNED', 'ESCALATED', 'CLOSED'],
      ASSIGNED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'ESCALATED', 'RESOLVED'],
      IN_PROGRESS: ['PENDING_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
      PENDING_INFORMATION: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED'],
      ESCALATED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'RESOLVED'],
      RESOLVED: ['IN_PROGRESS', 'CLOSED'],
      CLOSED: ['IN_PROGRESS'],
    };
    if (!transitions[ticket.status].includes(status as TicketStatus)) {
      throw new Error(`Invalid status transition: ${ticket.status} to ${status}`);
    }
    const from = ticket.status;
    ticket.status = status as TicketStatus;
    if (status === 'RESOLVED' && !ticket.resolvedAt) ticket.resolvedAt = new Date().toISOString();
    this.audit(ticket, user, status === 'RESOLVED' ? 'TICKET_RESOLVED' : 'TICKET_STATUS_CHANGED', { from, to: status });
    return ticket;
  }

  simulateInbound(body: { phone: string; text?: string; mediaType?: string; duplicate?: boolean; providerId?: string }) {
    const agent = this.agents.find((item) => item.phone === body.phone);
    if (!agent) throw new Error('Phone number is not a registered field agent');
    let ticket = [...this.ticketStore].reverse().find((item) => item.agent.phone === body.phone && !['RESOLVED', 'CLOSED'].includes(item.status));
    const providerId = body.providerId ?? (body.duplicate ? 'duplicate-preserved-id' : `sim-${randomUUID()}`);
    if (this.providerMessageIds.has(providerId)) {
      if (ticket) this.audit(ticket, 'system', 'DUPLICATE_WEBHOOK_IGNORED', { providerId, simulated: true });
      return { ticketId: ticket?.id ?? null, reference: ticket?.reference ?? null, providerId, duplicate: true };
    }
    this.providerMessageIds.add(providerId);
    if (!body.duplicate && !ticket) {
      const assignedUserId = this.assignLeastLoaded('Zambia Field Support');
      ticket = {
        id: randomUUID(),
        reference: `GSM-${String(this.serial++).padStart(6, '0')}`,
        subject: body.text?.slice(0, 80) ?? `${body.mediaType ?? 'Media'} attachment`,
        status: assignedUserId ? 'ASSIGNED' : 'UNASSIGNED',
        priority: 2,
        assignedUserId,
        team: 'Zambia Field Support',
        region: agent.region,
        firstResponseAt: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        agent,
        messages: [],
        audit: [],
      };
      this.ticketStore.push(ticket);
      this.audit(ticket, 'system', 'TICKET_CREATED', { routing: assignedUserId ? 'HYBRID_LEAST_LOADED' : 'UNASSIGNED' });
      if (assignedUserId) this.audit(ticket, 'system', 'TICKET_ASSIGNED', { userId: assignedUserId });
    }
    if (!ticket) throw new Error('Unable to associate ticket');
    ticket.messages.push({
      id: providerId,
      direction: 'INBOUND',
      body: body.text ?? `[SIMULATED ${(body.mediaType?.toUpperCase() ?? 'MEDIA')} ATTACHMENT]`,
      state: 'DELIVERED',
      simulated: true,
      createdAt: new Date().toISOString(),
    });
    ticket.lastMessageAt = new Date().toISOString();
    this.audit(ticket, 'system', 'MESSAGE_RECEIVED', { providerId, duplicate: Boolean(body.duplicate), simulated: true });
    return { ticketId: ticket.id, reference: ticket.reference, providerId, duplicate: Boolean(body.duplicate) };
  }

  fieldAgents() {
    return this.agents;
  }

  reports(role: string, user: string) {
    if (role !== 'SUPERVISOR' && role !== 'ADMINISTRATOR') throw new Error('Supervisor authorisation required');
    const visible = this.visible(role, user);
    const inbound = visible.flatMap((ticket) => ticket.messages).filter((message) => message.direction === 'INBOUND');
    const outbound = visible.flatMap((ticket) => ticket.messages).filter((message) => message.direction === 'OUTBOUND');
    const responseSamples = visible.filter((ticket) => ticket.firstResponseAt).map((ticket) =>
      (new Date(ticket.firstResponseAt as string).getTime() - new Date(ticket.createdAt).getTime()) / 60000
    );
    const resolutionSamples = visible.filter((ticket) => ticket.resolvedAt).map((ticket) =>
      (new Date(ticket.resolvedAt as string).getTime() - new Date(ticket.createdAt).getTime()) / 60000
    );
    const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    const byDate = (messages: Ticket['messages']) => messages.reduce<Record<string, number>>((result, message) => {
      const date = message.createdAt.slice(0, 10);
      result[date] = (result[date] ?? 0) + 1;
      return result;
    }, {});
    return {
      ticketsCreated: visible.length,
      ticketsResolved: visible.filter((ticket) => ticket.status === 'RESOLVED' || ticket.status === 'CLOSED').length,
      ticketsOpen: visible.filter((ticket) => !['RESOLVED', 'CLOSED'].includes(ticket.status)).length,
      inboundMessages: inbound.length,
      outboundMessages: outbound.length,
      failedOutboundMessages: outbound.filter((message) => message.state === 'FAILED').length,
      averageFirstResponseMinutes: average(responseSamples),
      averageResolutionMinutes: average(resolutionSamples),
      escalations: visible.filter((ticket) => ticket.status === 'ESCALATED').length,
      unassignedCases: visible.filter((ticket) => ticket.status === 'UNASSIGNED').length,
      assignmentDistribution: this.users
        .filter((item) => item.role === 'BACK_OFFICE')
        .map((item) => ({ name: item.name, tickets: visible.filter((ticket) => ticket.assignedUserId === item.id).length })),
      casesByRegion: visible.reduce<Record<string, number>>((result, ticket) => {
        result[ticket.region] = (result[ticket.region] ?? 0) + 1;
        return result;
      }, {}),
      inboundByDate: byDate(inbound),
      outboundByDate: byDate(outbound),
    };
  }

  reportCsv(role: string, user: string) {
    const report = this.reports(role, user);
    const rows = [
      ['metric', 'value'],
      ...Object.entries(report)
        .filter(([, value]) => typeof value === 'number')
        .map(([metric, value]) => [metric, String(value)]),
      ['assignment_distribution', JSON.stringify(report.assignmentDistribution)],
      ['cases_by_region', JSON.stringify(report.casesByRegion)],
      ['inbound_by_date', JSON.stringify(report.inboundByDate)],
      ['outbound_by_date', JSON.stringify(report.outboundByDate)],
    ];
    return rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
  }
}
