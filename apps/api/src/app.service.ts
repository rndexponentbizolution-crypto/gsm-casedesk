import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService, type Tx } from './audit.service';
import {
  BOT_HANDLED,
  BOT_TEXT,
  type BotState,
  extractMsisdn,
  type InteractiveList,
  isPinResetPhrase,
  isRestartPhrase,
  listOf,
  matchOption,
  MENUS,
} from './bot';
import { messagingMode } from './config';
import { PrismaService } from './prisma.service';
import {
  CONVERSATION_RESET_MS,
  GSM_BACKOFFICE_EMAIL,
  isQueryType,
  QUERY_TYPES,
  type QueryTypeKey,
} from './query-types';
import {
  fillTemplate,
  RESPONSE_BY_ID,
  RESPONSES,
  type ResponseEffect,
} from './responses';
import { SERVABLE, ScannerService, type ScanStatus } from './scanner';
import { StorageService } from './storage';
import type { OutboundPayload } from './whatsapp';

const DEFAULT_TEAM = 'Zambia Field Support';
const CLOSED_STATES: TicketStatus[] = ['RESOLVED', 'CLOSED'];
const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };
/** Inbound events still unprocessed after this long count as stuck. */
export const STUCK_AFTER_MS = 2 * 60 * 1000;
// Zambia is UTC+2 all year (no DST); used for the daily log's calendar day.
const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  UNASSIGNED: ['ASSIGNED', 'ESCALATED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['PENDING_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_INFORMATION: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['IN_PROGRESS', 'PENDING_INFORMATION', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
};

const ticketInclude = {
  conversation: {
    include: { contact: { include: { fieldAgent: true } } },
  },
  team: true,
  assignments: {
    where: { active: true },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { attachments: { orderBy: { createdAt: 'asc' } } },
  },
  auditEvents: { orderBy: { createdAt: 'asc' }, include: { actor: true } },
} satisfies Prisma.TicketInclude;

type TicketRecord = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

/** Casework stored in Ticket.details. */
export interface CaseDetails {
  msisdn?: string;
  nrcNumber?: string;
  region?: string;
  locationName?: string;
  shopType?: string;
  balanceZmw?: number | null;
  validation?: Record<string, boolean>;
  verification?: Record<string, boolean>;
  resolved?: boolean;
  executedAt?: string;
  escalation?: {
    subject: string;
    attachments: string[];
    email: string;
    escalatedAt: string;
    dueAt: string;
    queryType?: string;
  };
}

export interface Ticket {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: number;
  assignedUserId: string | null;
  team: string;
  region: string;
  queryType: string | null;
  queryTypeLabel: string | null;
  tags: string[];
  slaDueAt: string | null;
  acknowledgedAt: string | null;
  outcome: string | null;
  details: CaseDetails;
  botState: BotState;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  lastMessageAt: string;
  agent: {
    id: string;
    name: string;
    phone: string;
    region: string | null;
    storeName: string | null;
    shopType: string | null;
  };
  messages: Array<{
    id: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
    body: string;
    state: string;
    simulated: boolean;
    sender: string | null;
    templateId: string | null;
    interactive: unknown;
    mediaType: string | null;
    createdAt: string;
    attachments: Array<{
      id: string;
      name: string;
      mimeType: string;
      size: number;
      scanStatus: string;
      /** False while scanning failed or the file was found infected. */
      available: boolean;
    }>;
  }>;
  audit: Array<{
    id: string;
    type: string;
    actor: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
}

export interface InboundInput {
  phone: string;
  text?: string;
  mediaType?: string;
  duplicate?: boolean;
  providerId?: string;
  /** Interactive list/button reply id (WhatsApp "list_reply.id"). */
  replyId?: string;
  /** A file that arrived with the message, already stored and scanned. */
  media?: StoredFile & { providerMediaId?: string };
}

/** A file that has been scanned and (unless infected) written to storage. */
export interface StoredFile {
  storageKey: string | null;
  name: string;
  mimeType: string;
  size: number;
  scanStatus: ScanStatus;
}

/** Files staff may send, and the WhatsApp message type each goes out as. */
export const SENDABLE_MEDIA: Record<string, 'image' | 'document' | 'audio' | 'video'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'document',
  'text/plain': 'document',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'video/mp4': 'video',
};
/** WhatsApp's documented upload limits are 5 MB for images, 16 MB for audio/video, 100 MB for documents; CaseDesk caps everything at 16 MB. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Digits-only and "+digits" forms of a phone number, for matching stored numbers. */
const phoneForms = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return [...new Set([phone, `+${digits}`, digits])];
};

/** The message mediaType label for a MIME type ("image", "document", ...). */
export const mediaKind = (mimeType: string) =>
  SENDABLE_MEDIA[mimeType] ??
  (/^(image|audio|video)\//.exec(mimeType)?.[1] || 'document');

const isPrivileged = (role: string) =>
  role === 'SUPERVISOR' || role === 'ADMINISTRATOR';

const asDetails = (value: Prisma.JsonValue | null): CaseDetails =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as CaseDetails)
    : {};

const addTags = (current: string[], ...next: string[]) => [
  ...new Set([...current, ...next]),
];

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audits: AuditService,
    private readonly storage: StorageService,
    private readonly scanner: ScannerService,
  ) {}

  private get live() {
    return messagingMode() === 'live';
  }

  // ---------- reference data ----------

  queryTypes() {
    return Object.values(QUERY_TYPES).map((type) => ({
      key: type.key,
      label: type.label,
      handledOnWhatsApp: type.handledOnWhatsApp,
      slaMinutes: type.slaMs === null ? null : type.slaMs / 60000,
      level: type.level,
    }));
  }

  responses() {
    return RESPONSES;
  }

  async databaseReachable() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // ---------- mapping & access ----------

  private toDto(record: TicketRecord): Ticket {
    const agent = record.conversation.contact.fieldAgent;
    const assignee = record.assignments[0]?.user ?? null;
    const queryType = isQueryType(record.queryType) ? record.queryType : null;
    return {
      id: record.id,
      reference: record.reference,
      subject: record.subject,
      status: record.status,
      priority: record.priority,
      assignedUserId: assignee?.keycloakId ?? null,
      team: record.team?.name ?? DEFAULT_TEAM,
      region: agent.region ?? record.team?.region ?? '',
      queryType: record.queryType,
      queryTypeLabel: queryType ? QUERY_TYPES[queryType].label : null,
      tags: record.tags,
      slaDueAt: record.slaDueAt?.toISOString() ?? null,
      acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
      outcome: record.outcome,
      details: asDetails(record.details),
      botState: record.conversation.botState as BotState,
      firstResponseAt: record.firstResponseAt?.toISOString() ?? null,
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      closedAt: record.closedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      lastMessageAt: record.lastMessageAt.toISOString(),
      agent: {
        id: agent.id,
        name: agent.name,
        phone: agent.phone,
        region: agent.region,
        storeName: agent.storeName,
        shopType: agent.shopType,
      },
      messages: record.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body ?? '',
        state: message.state,
        simulated: message.isSimulated,
        sender: message.sender,
        templateId: message.templateId,
        interactive: message.interactive,
        mediaType: message.mediaType,
        createdAt: message.createdAt.toISOString(),
        attachments: message.attachments.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          scanStatus: file.scanStatus,
          available:
            Boolean(file.storageKey) &&
            SERVABLE.includes(file.scanStatus as ScanStatus),
        })),
      })),
      audit: record.auditEvents.map((event) => {
        // `_v` is the audit hash format version, not something to show.
        const { _v, ...metadata } = (event.metadata ?? {}) as Record<
          string,
          unknown
        >;
        void _v;
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
    if (!this.authorised(role, user, ticket)) {
      await this.denied(user, id);
      throw new ForbiddenException('Not authorised');
    }
    return ticket;
  }

  /** Audits a refused attempt to reach a ticket the user may not see. */
  private async denied(user: string, ticketId: string) {
    await this.audits.recordNow(ticketId, user, 'ACCESS_DENIED', {
      resource: 'ticket',
    });
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

  private async recordStatus(
    tx: Tx,
    ticketId: string,
    from: TicketStatus | null,
    to: TicketStatus,
    actor: string,
    reason?: string,
  ) {
    if (from === to) return;
    const actorUser =
      actor === 'system' || actor === 'bot'
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

  async dashboard(role: string, user: string) {
    const [visible, staff, stuckInbound] = await Promise.all([
      this.visible(role, user),
      this.backOfficeUsers(),
      // Webhook events are not tied to a ticket yet, so only supervisors see them.
      isPrivileged(role)
        ? this.prisma.inboundWebhookEvent.count({
            where: {
              OR: [
                { status: 'FAILED' },
                {
                  status: { in: ['RECEIVED', 'PROCESSING'] },
                  createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) },
                },
              ],
            },
          })
        : Promise.resolve(0),
    ]);
    const now = Date.now();
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
      withBot: visible.filter(
        (ticket) => isOpen(ticket) && BOT_HANDLED.includes(ticket.botState),
      ).length,
      slaBreached: visible.filter(
        (ticket) =>
          isOpen(ticket) &&
          ticket.slaDueAt &&
          new Date(ticket.slaDueAt).getTime() < now,
      ).length,
      failedOutbound: visible
        .flatMap((ticket) => ticket.messages)
        .filter((message) => ['FAILED', 'AMBIGUOUS'].includes(message.state))
        .length,
      stuckInbound,
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
      assignee:
        (ticket.assignedUserId && names.get(ticket.assignedUserId)) ||
        'Unassigned',
    }));
  }

  async ticket(role: string, user: string, id: string): Promise<Ticket | null> {
    const record = await this.loadTicket(id);
    if (!record) return null;
    const ticket = this.toDto(record);
    if (this.authorised(role, user, ticket)) return ticket;
    await this.denied(user, id);
    return null;
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
      storeName: agent.storeName,
      shopType: agent.shopType,
      active: agent.active,
    }));
  }

  // ---------- outbound ----------

  /**
   * Records an outbound message. In simulation it is "sent" at once. Live, it starts
   * PENDING with an outbox row; the OutboxService delivers it to Meta and retries.
   */
  private async createOutbound(
    tx: Tx,
    args: {
      ticketId: string;
      conversationId: string;
      body: string;
      sender: string;
      createdAt: Date;
      templateId?: string;
      interactive?: InteractiveList;
      file?: StoredFile & {
        mediaType: 'image' | 'document' | 'audio' | 'video';
      };
    },
  ) {
    const live = this.live;
    const { file } = args;
    const message = await tx.message.create({
      data: {
        ticketId: args.ticketId,
        conversationId: args.conversationId,
        direction: 'OUTBOUND',
        body: args.body,
        state: live ? 'PENDING' : 'SENT',
        isSimulated: !live,
        sender: args.sender,
        templateId: args.templateId,
        interactive: args.interactive as Prisma.InputJsonValue | undefined,
        mediaType: file?.mediaType,
        createdAt: args.createdAt,
        attachments: file
          ? {
              create: {
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                storageKey: file.storageKey,
                scanStatus: file.scanStatus,
              },
            }
          : undefined,
      },
    });
    if (live) {
      const { contact } = await tx.conversation.findUniqueOrThrow({
        where: { id: args.conversationId },
        include: { contact: true },
      });
      const payload: OutboundPayload = file
        ? {
            kind: 'media',
            to: contact.phone,
            mediaType: file.mediaType,
            storageKey: file.storageKey!,
            mimeType: file.mimeType,
            filename: file.name,
            caption: args.body || undefined,
          }
        : {
            kind: 'text',
            to: contact.phone,
            body: args.body,
            interactive: args.interactive,
          };
      await tx.outboundMessageOutbox.create({
        data: {
          messageId: message.id,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return message;
  }

  // ---------- bot ----------

  private async botSay(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    body: string,
    interactive?: InteractiveList,
    templateId?: string,
  ) {
    await this.createOutbound(tx, {
      ticketId,
      conversationId,
      body,
      sender: 'bot',
      templateId,
      interactive,
      // Bot replies land just after the inbound message that triggered them.
      createdAt: new Date(Date.now() + 1),
    });
  }

  private async setBotState(tx: Tx, conversationId: string, state: BotState) {
    await tx.conversation.update({
      where: { id: conversationId },
      data: { botState: state, botUpdatedAt: new Date() },
    });
  }

  private async showMainMenu(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    withWelcome: boolean,
  ) {
    await this.botSay(
      tx,
      ticketId,
      conversationId,
      withWelcome ? BOT_TEXT.welcome : BOT_TEXT.menuPrompt,
      listOf(MENUS.main),
    );
    await this.setBotState(tx, conversationId, 'MENU');
  }

  private async startPinReset(
    tx: Tx,
    ticketId: string,
    conversationId: string,
  ) {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        queryType: 'PIN_RESET',
        tags: addTags(ticket.tags, 'query_pin_reset', 'channel_whatsapp'),
      },
    });
    await this.botSay(tx, ticketId, conversationId, BOT_TEXT.pinDetails);
    await this.setBotState(tx, conversationId, 'AWAITING_PIN_DETAILS');
    await this.audits.record(tx, ticketId, 'bot', 'BOT_QUERY_SELECTED', {
      queryType: 'PIN_RESET',
    });
  }

  /** "pin reset end" flow: high priority, 5-minute SLA, hand to the least-loaded agent. */
  private async routePinReset(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    msisdn: string | null,
  ) {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    const team = await tx.team.upsert({
      where: { name: DEFAULT_TEAM },
      update: {},
      create: { name: DEFAULT_TEAM, region: 'Zambia' },
    });
    const assignee = await this.assignLeastLoaded(tx, team.id);
    const status: TicketStatus = assignee ? 'ASSIGNED' : 'UNASSIGNED';
    const ack = RESPONSE_BY_ID.get('ack-pin-reset')!;
    const details = asDetails(ticket.details);
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status,
        priority: 1,
        teamId: team.id,
        subject: 'PIN reset request',
        slaDueAt: new Date(Date.now() + (QUERY_TYPES.PIN_RESET.slaMs ?? 0)),
        tags: addTags(
          ticket.tags,
          'awaiting_agent',
          'sla_5min',
          'priority_high',
        ),
        details: {
          ...details,
          msisdn: details.msisdn ?? msisdn ?? undefined,
        } as Prisma.InputJsonValue,
      },
    });
    await this.recordStatus(
      tx,
      ticketId,
      ticket.status,
      status,
      'bot',
      'PIN reset details received',
    );
    // "Pin Reset Flow initiation": the acknowledgement goes out automatically.
    await this.botSay(
      tx,
      ticketId,
      conversationId,
      fillTemplate(ack.body, {}),
      undefined,
      ack.id,
    );
    if (assignee) {
      await tx.ticketAssignment.create({
        data: {
          ticketId,
          userId: assignee.id,
          reason: 'PIN_RESET_HIGH_PRIORITY',
        },
      });
      await this.audits.record(tx, ticketId, 'system', 'TICKET_ASSIGNED', {
        userId: assignee.keycloakId,
        routing: 'HYBRID_LEAST_LOADED',
      });
    }
    await this.audits.record(tx, ticketId, 'bot', 'PIN_RESET_ROUTED', {
      slaMinutes: 5,
      priority: 'high',
    });
    await this.setBotState(tx, conversationId, 'WITH_AGENT');
  }

  /** Non-PIN-reset queries: channel policy says email only. */
  private async redirectToEmail(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    queryType: QueryTypeKey,
  ) {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    const redirect = RESPONSE_BY_ID.get('redirect-email')!;
    const now = new Date();
    await this.botSay(
      tx,
      ticketId,
      conversationId,
      fillTemplate(redirect.body, {}),
      undefined,
      redirect.id,
    );
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        queryType,
        subject: QUERY_TYPES[queryType].label,
        status: 'CLOSED',
        closedAt: now,
        outcome: 'Redirected to email',
        tags: addTags(
          ticket.tags,
          QUERY_TYPES[queryType].tag,
          'channel_whatsapp',
          'redirect_to_email',
        ),
        details: {
          ...asDetails(ticket.details),
          resolved: false,
          executedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await this.recordStatus(
      tx,
      ticketId,
      ticket.status,
      'CLOSED',
      'bot',
      'Redirected to email',
    );
    // "notifyOperators": the field agent will escalate by email shortly.
    await this.audits.record(tx, ticketId, 'bot', 'BOT_REDIRECTED_TO_EMAIL', {
      queryType,
      email: GSM_BACKOFFICE_EMAIL,
    });
    await this.setBotState(tx, conversationId, 'IDLE');
  }

  private async selectQuery(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    optionId: string,
  ) {
    if (optionId === 'PIN_RESET')
      return this.startPinReset(tx, ticketId, conversationId);
    if (optionId === 'MENU_OTHER') {
      await this.botSay(
        tx,
        ticketId,
        conversationId,
        BOT_TEXT.otherPrompt,
        listOf(MENUS.other),
      );
      return this.setBotState(tx, conversationId, 'OTHER_MENU');
    }
    if (isQueryType(optionId))
      return this.redirectToEmail(tx, ticketId, conversationId, optionId);
  }

  /** One step of the entry bot, after the inbound message has been stored. */
  private async runBot(
    tx: Tx,
    ticketId: string,
    conversationId: string,
    state: BotState,
    isNewTicket: boolean,
    input: InboundInput,
  ) {
    const text = input.text;
    if (state === 'IDLE' || isNewTicket) {
      if (isPinResetPhrase(text))
        return this.startPinReset(tx, ticketId, conversationId);
      const choice = matchOption(MENUS.main, input);
      if (choice && input.replyId)
        return this.selectQuery(tx, ticketId, conversationId, choice.id);
      return this.showMainMenu(tx, ticketId, conversationId, true);
    }
    if (state === 'MENU' || state === 'OTHER_MENU') {
      if (isPinResetPhrase(text))
        return this.startPinReset(tx, ticketId, conversationId);
      if (isRestartPhrase(text))
        return this.showMainMenu(tx, ticketId, conversationId, true);
      const options = state === 'MENU' ? MENUS.main : MENUS.other;
      const choice = matchOption(options, input);
      if (choice)
        return this.selectQuery(tx, ticketId, conversationId, choice.id);
      // Unrecognised: re-ask with the same menu.
      return this.botSay(
        tx,
        ticketId,
        conversationId,
        state === 'MENU' ? BOT_TEXT.menuPrompt : BOT_TEXT.otherPrompt,
        listOf(options),
      );
    }
    if (state === 'AWAITING_PIN_DETAILS')
      return this.routePinReset(
        tx,
        ticketId,
        conversationId,
        extractMsisdn(text),
      );
    // WITH_AGENT: a person is handling it; the bot stays quiet.
  }

  /** Simulator only. An optional uploaded file is stored like a real inbound attachment. */
  async simulateInbound(
    body: InboundInput,
    file?: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (this.live)
      throw new BadRequestException(
        'The simulator is off while live WhatsApp is enabled',
      );
    if (file) {
      const stored = await this.storeFile(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      body = {
        ...body,
        media: stored,
        mediaType: body.mediaType ?? mediaKind(file.mimetype),
      };
    }
    return this.handleInbound(body, true);
  }

  /**
   * Scans a file and writes it to storage under a fresh key. Infected files are
   * not stored at all: the result has storageKey null and scanStatus INFECTED.
   */
  async storeFile(
    buffer: Buffer,
    name: string,
    mimeType: string,
  ): Promise<StoredFile> {
    const safeName =
      name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'attachment';
    const scan = await this.scanner.scan(buffer);
    const stored: StoredFile = {
      storageKey: null,
      name: safeName,
      mimeType,
      size: buffer.length,
      scanStatus: scan.status,
    };
    if (scan.status === 'INFECTED') return stored;
    stored.storageKey = `attachments/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
    await this.storage.put(stored.storageKey, buffer, mimeType);
    return stored;
  }

  /** Entry point for every inbound WhatsApp message (simulated or from Meta's webhook). */
  async handleInbound(body: InboundInput, simulated: boolean) {
    const agent = await this.prisma.fieldAgent.findFirst({
      where: { phone: { in: phoneForms(body.phone) }, active: true },
    });
    if (!agent)
      throw new BadRequestException(
        'Phone number is not a registered field agent',
      );
    const providerId =
      body.providerId ??
      (body.duplicate ? 'duplicate-preserved-id' : `sim-${randomUUID()}`);

    return this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);

      const contact = await tx.whatsAppContact.upsert({
        where: { phone: agent.phone },
        update: {},
        create: { phone: agent.phone, fieldAgentId: agent.id },
      });
      let conversation = await tx.conversation.upsert({
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
          await this.audits.record(
            tx,
            ticket.id,
            'system',
            'DUPLICATE_WEBHOOK_IGNORED',
            {
              providerId,
              simulated,
            },
          );
        return {
          ticketId: ticket?.id ?? null,
          reference: ticket?.reference ?? null,
          providerId,
          duplicate: true,
          botState: conversation.botState,
        };
      }

      let state = conversation.botState as BotState;
      // "Proactive Conversation reset": a stale bot conversation starts over.
      const stale =
        conversation.botUpdatedAt &&
        Date.now() - conversation.botUpdatedAt.getTime() >
          CONVERSATION_RESET_MS;
      if (stale && BOT_HANDLED.includes(state)) {
        if (ticket && !ticket.queryType) {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: {
              status: 'CLOSED',
              closedAt: new Date(),
              outcome: 'Abandoned in menu',
            },
          });
          await this.recordStatus(
            tx,
            ticket.id,
            ticket.status,
            'CLOSED',
            'bot',
            'Menu timed out',
          );
          ticket = null;
        }
        state = 'IDLE';
      }
      if (!ticket && state === 'WITH_AGENT') state = 'IDLE';

      let isNewTicket = false;
      if (!ticket) {
        if (body.duplicate)
          throw new BadRequestException('Unable to associate ticket');
        ticket = await tx.ticket.create({
          data: {
            reference: await this.nextReference(tx),
            conversationId: conversation.id,
            subject:
              body.text?.slice(0, 80) ??
              `${body.mediaType ?? 'Media'} attachment`,
            status: 'NEW',
            priority: 2,
            tags: ['channel_whatsapp'],
          },
        });
        isNewTicket = true;
        await this.recordStatus(
          tx,
          ticket.id,
          null,
          'NEW',
          'system',
          'Created from inbound message',
        );
        await this.audits.record(tx, ticket.id, 'system', 'TICKET_CREATED', {
          channel: 'whatsapp',
        });
      }

      const now = new Date();
      await tx.message.create({
        data: {
          providerId,
          ticketId: ticket.id,
          conversationId: conversation.id,
          direction: 'INBOUND',
          body:
            body.text ??
            `[${(body.mediaType ?? 'media').toUpperCase()} ATTACHMENT]`,
          mediaType: body.mediaType,
          interactive: body.replyId
            ? ({ replyId: body.replyId } as Prisma.InputJsonValue)
            : undefined,
          state: 'DELIVERED',
          isSimulated: simulated,
          createdAt: now,
          attachments: body.media
            ? {
                create: {
                  name: body.media.name,
                  mimeType: body.media.mimeType,
                  size: body.media.size,
                  storageKey: body.media.storageKey,
                  scanStatus: body.media.scanStatus,
                  providerMediaId: body.media.providerMediaId,
                },
              }
            : undefined,
        },
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: now },
      });
      await this.audits.record(tx, ticket.id, 'system', 'MESSAGE_RECEIVED', {
        providerId,
        duplicate: Boolean(body.duplicate),
        simulated,
      });

      if (state === 'WITH_AGENT' && ticket.status === 'PENDING_INFORMATION') {
        // The field agent came back with what was asked for: back into the queue.
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'IN_PROGRESS' },
        });
        await this.recordStatus(
          tx,
          ticket.id,
          'PENDING_INFORMATION',
          'IN_PROGRESS',
          'system',
          'Field agent responded',
        );
      }

      await this.runBot(
        tx,
        ticket.id,
        conversation.id,
        state,
        isNewTicket,
        body,
      );
      conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      return {
        ticketId: ticket.id,
        reference: ticket.reference,
        providerId,
        duplicate: Boolean(body.duplicate),
        botState: conversation.botState,
      };
    }, TX_OPTIONS);
  }

  // ---------- staff actions ----------

  private async closeConversationIfDone(
    tx: Tx,
    conversationId: string,
    status: TicketStatus,
  ) {
    await this.setBotState(
      tx,
      conversationId,
      CLOSED_STATES.includes(status) ? 'IDLE' : 'WITH_AGENT',
    );
  }

  /** Apply a standard response's effect to the ticket. Returns the new status. */
  private async applyEffect(
    tx: Tx,
    ticket: Ticket,
    effect: ResponseEffect,
    user: string,
    now: Date,
  ): Promise<TicketStatus> {
    const details: CaseDetails = { ...ticket.details };
    const data: Prisma.TicketUpdateInput = {};
    let status: TicketStatus = ticket.status;
    let outcome: string | undefined;
    switch (effect.kind) {
      case 'acknowledge':
        if (
          ['NEW', 'UNASSIGNED', 'ASSIGNED', 'PENDING_INFORMATION'].includes(
            status,
          )
        )
          status = 'IN_PROGRESS';
        break;
      case 'resolve':
        status = 'RESOLVED';
        outcome = effect.outcome;
        data.resolvedAt = ticket.resolvedAt ? undefined : now;
        details.resolved = true;
        details.executedAt = now.toISOString();
        break;
      case 'close':
        status = 'CLOSED';
        outcome = effect.outcome;
        data.closedAt = now;
        details.resolved = false;
        details.executedAt = now.toISOString();
        break;
      case 'pending':
        status = 'PENDING_INFORMATION';
        outcome = effect.outcome;
        break;
      case 'escalate': {
        const dueAt = new Date(now.getTime() + effect.slaHours * 3600_000);
        status = 'ESCALATED';
        outcome = `Escalated: ${effect.subject}`;
        data.escalation = true;
        data.slaDueAt = dueAt;
        data.tags = addTags(ticket.tags, 'escalated');
        details.resolved = false;
        details.executedAt = now.toISOString();
        details.escalation = {
          subject: effect.subject,
          attachments: effect.attachments,
          email: GSM_BACKOFFICE_EMAIL,
          escalatedAt: now.toISOString(),
          dueAt: dueAt.toISOString(),
          queryType: effect.queryType,
        };
        break;
      }
      case 'redirect_email':
        status = 'CLOSED';
        outcome = 'Redirected to email';
        data.closedAt = now;
        data.tags = addTags(ticket.tags, 'redirect_to_email');
        details.resolved = false;
        details.executedAt = now.toISOString();
        break;
      case 'info':
        break;
    }
    if (outcome) data.outcome = outcome;
    data.status = status;
    data.details = details as Prisma.InputJsonValue;
    await tx.ticket.update({ where: { id: ticket.id }, data });
    await this.recordStatus(
      tx,
      ticket.id,
      ticket.status,
      status,
      user,
      outcome,
    );
    if (effect.kind === 'escalate')
      await this.audits.record(tx, ticket.id, user, 'TICKET_ESCALATED', {
        subject: effect.subject,
        email: GSM_BACKOFFICE_EMAIL,
      });
    else if (status !== ticket.status)
      await this.audits.record(
        tx,
        ticket.id,
        user,
        status === 'RESOLVED' ? 'TICKET_RESOLVED' : 'TICKET_STATUS_CHANGED',
        { from: ticket.status, to: status, outcome: outcome ?? null },
      );
    return status;
  }

  async reply(
    role: string,
    user: string,
    id: string,
    text?: string,
    templateId?: string,
  ) {
    const ticket = await this.loadAuthorised(role, user, id);
    if (!text?.trim()) throw new BadRequestException('Reply text is required');
    if (CLOSED_STATES.includes(ticket.status))
      throw new BadRequestException('Reopen the case before replying');
    const template = templateId ? RESPONSE_BY_ID.get(templateId) : undefined;
    if (templateId && !template)
      throw new BadRequestException(`Unknown response: ${templateId}`);

    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      const now = new Date();
      const { conversationId } = await tx.ticket.findUniqueOrThrow({
        where: { id },
        select: { conversationId: true },
      });
      const message = await this.createOutbound(tx, {
        ticketId: ticket.id,
        conversationId,
        body: text.trim(),
        sender: user,
        templateId: template?.id,
        createdAt: now,
      });
      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
          firstResponseAt: ticket.firstResponseAt ? undefined : now,
          // SOP "time of pickup": the first time staff act on the query.
          acknowledgedAt: ticket.acknowledgedAt ? undefined : now,
        },
      });
      await this.audits.record(tx, id, user, 'REPLY_SUBMITTED', {
        simulated: !this.live,
        templateId: template?.id ?? null,
      });
      await this.audits.record(
        tx,
        id,
        user,
        this.live ? 'MESSAGE_QUEUED' : 'MESSAGE_SENT',
        { provider: this.live ? 'meta' : 'simulation', messageId: message.id },
      );
      const effect: ResponseEffect = template?.effect ?? { kind: 'info' };
      let status = await this.applyEffect(tx, ticket, effect, user, now);
      if (effect.kind === 'info' && status === 'ASSIGNED') {
        status = 'IN_PROGRESS';
        await tx.ticket.update({ where: { id }, data: { status } });
        await this.recordStatus(
          tx,
          id,
          'ASSIGNED',
          status,
          user,
          'First reply',
        );
      }
      await this.closeConversationIfDone(tx, conversationId, status);
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  /** Staff send a file (with an optional caption) to the field agent. */
  async sendMedia(
    role: string,
    user: string,
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    caption?: string,
  ) {
    const ticket = await this.loadAuthorised(role, user, id);
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    if (CLOSED_STATES.includes(ticket.status))
      throw new BadRequestException('Reopen the case before replying');
    const mediaType = SENDABLE_MEDIA[file.mimetype];
    if (!mediaType)
      throw new BadRequestException(
        `Files of type ${file.mimetype || 'unknown'} can't be sent on WhatsApp`,
      );
    if (file.buffer.length > MAX_MEDIA_BYTES)
      throw new BadRequestException('Files must be 16 MB or smaller');
    const stored = await this.storeFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    if (stored.scanStatus === 'INFECTED') {
      await this.audits.recordNow(id, user, 'ATTACHMENT_REJECTED', {
        name: stored.name,
        reason: 'virus scan',
      });
      throw new BadRequestException(
        'The virus scanner flagged this file; it was not sent',
      );
    }
    if (stored.scanStatus === 'SCAN_FAILED')
      throw new BadRequestException(
        'The file could not be virus-scanned; try again shortly',
      );
    const text = caption?.trim().slice(0, 1024) ?? '';
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      const now = new Date();
      const { conversationId } = await tx.ticket.findUniqueOrThrow({
        where: { id },
        select: { conversationId: true },
      });
      const message = await this.createOutbound(tx, {
        ticketId: id,
        conversationId,
        body: text,
        sender: user,
        createdAt: now,
        file: { ...stored, mediaType },
      });
      const status: TicketStatus =
        ticket.status === 'ASSIGNED' ? 'IN_PROGRESS' : ticket.status;
      await tx.ticket.update({
        where: { id },
        data: {
          status,
          lastMessageAt: now,
          firstResponseAt: ticket.firstResponseAt ? undefined : now,
          acknowledgedAt: ticket.acknowledgedAt ? undefined : now,
        },
      });
      await this.recordStatus(tx, id, ticket.status, status, user, 'First reply');
      await this.audits.record(
        tx,
        id,
        user,
        this.live ? 'MEDIA_QUEUED' : 'MEDIA_SENT',
        {
          messageId: message.id,
          name: stored.name,
          mimeType: stored.mimeType,
          size: stored.size,
          scanStatus: stored.scanStatus,
        },
      );
      await this.closeConversationIfDone(tx, conversationId, status);
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  /** An attachment's bytes, for someone allowed to see its ticket. Audited. */
  async attachment(role: string, user: string, attachmentId: string) {
    const file = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { ticketId: true } } },
    });
    if (!file) throw new NotFoundException('Attachment not found');
    await this.loadAuthorised(role, user, file.message.ticketId);
    if (!file.storageKey || !SERVABLE.includes(file.scanStatus as ScanStatus))
      throw new BadRequestException(
        file.scanStatus === 'INFECTED'
          ? 'This file was flagged by the virus scanner and is not available'
          : 'This file is not available',
      );
    const body = await this.storage.get(file.storageKey);
    await this.audits.recordNow(
      file.message.ticketId,
      user,
      'ATTACHMENT_DOWNLOADED',
      { attachmentId: file.id, name: file.name },
    );
    return { body, name: file.name, mimeType: file.mimeType };
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
      await this.audits.lock(tx);
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
      const next: TicketStatus = ['NEW', 'UNASSIGNED'].includes(ticket.status)
        ? 'ASSIGNED'
        : ticket.status;
      await tx.ticket.update({ where: { id }, data: { status: next } });
      await this.recordStatus(tx, id, ticket.status, next, user, 'Reassigned');
      if (!CLOSED_STATES.includes(next))
        await this.setBotState(tx, ticket.conversationId, 'WITH_AGENT');
      await this.audits.record(tx, id, user, 'TICKET_REASSIGNED', {
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
      await this.audits.lock(tx);
      const now = new Date();
      const reopening =
        CLOSED_STATES.includes(ticket.status) && !CLOSED_STATES.includes(to);
      const record = await tx.ticket.update({
        where: { id },
        data: {
          status: to,
          resolvedAt: to === 'RESOLVED' && !ticket.resolvedAt ? now : undefined,
          closedAt: to === 'CLOSED' ? now : undefined,
          outcome: reopening ? null : undefined,
          acknowledgedAt: ticket.acknowledgedAt ? undefined : now,
        },
      });
      await this.recordStatus(tx, id, ticket.status, to, user);
      await this.audits.record(
        tx,
        id,
        user,
        to === 'RESOLVED' ? 'TICKET_RESOLVED' : 'TICKET_STATUS_CHANGED',
        { from: ticket.status, to },
      );
      await this.closeConversationIfDone(tx, record.conversationId, to);
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  /** Update casework: query type, log fields, validation/verification checklists. */
  async updateCase(
    role: string,
    user: string,
    id: string,
    patch: { queryType?: string; details?: Record<string, unknown> },
  ) {
    const ticket = await this.loadAuthorised(role, user, id);
    if (patch.queryType !== undefined && !isQueryType(patch.queryType))
      throw new BadRequestException(`Unknown query type: ${patch.queryType}`);
    const textFields = [
      'msisdn',
      'nrcNumber',
      'region',
      'locationName',
      'shopType',
    ] as const;
    const allowed = [...textFields, 'balanceZmw', 'validation', 'verification'];
    const incoming = patch.details ?? {};
    const unknown = Object.keys(incoming).filter(
      (key) => !allowed.includes(key),
    );
    if (unknown.length)
      throw new BadRequestException(
        `Unknown case fields: ${unknown.join(', ')}`,
      );
    const details: CaseDetails = { ...ticket.details };
    for (const key of textFields) {
      if (key in incoming)
        details[key] = String(incoming[key] ?? '')
          .trim()
          .slice(0, 120);
    }
    if ('balanceZmw' in incoming) {
      const raw = incoming.balanceZmw;
      const value = raw === null || raw === '' ? null : Number(raw);
      if (value !== null && !Number.isFinite(value))
        throw new BadRequestException('Balance must be a number');
      details.balanceZmw = value;
    }
    for (const key of ['validation', 'verification'] as const) {
      const value = incoming[key];
      if (value === undefined) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException(`${key} must be an object of booleans`);
      const flags = Object.fromEntries(
        Object.entries(value).map(([flag, checked]) => [
          flag,
          Boolean(checked),
        ]),
      );
      details[key] = { ...(details[key] ?? {}), ...flags };
    }
    const queryType = patch.queryType as QueryTypeKey | undefined;
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      await tx.ticket.update({
        where: { id },
        data: {
          details: details as Prisma.InputJsonValue,
          queryType: queryType ?? undefined,
          tags: queryType
            ? addTags(ticket.tags, QUERY_TYPES[queryType].tag)
            : undefined,
          acknowledgedAt: ticket.acknowledgedAt ? undefined : new Date(),
        },
      });
      await this.audits.record(tx, id, user, 'CASE_UPDATED', {
        fields: [...Object.keys(incoming), ...(queryType ? ['queryType'] : [])],
        ...(queryType ? { queryType } : {}),
      });
    }, TX_OPTIONS);
    return this.toDto((await this.loadTicket(id))!);
  }

  // ---------- reporting ----------

  async reports(role: string, user: string) {
    if (!isPrivileged(role))
      throw new ForbiddenException('Supervisor authorisation required');
    const [visible, staff] = await Promise.all([
      this.visible(role, user),
      this.backOfficeUsers(),
    ]);
    const now = Date.now();
    const allMessages = visible.flatMap((ticket) => ticket.messages);
    const inbound = allMessages.filter(
      (message) => message.direction === 'INBOUND',
    );
    const outbound = allMessages.filter(
      (message) => message.direction === 'OUTBOUND' && message.sender !== 'bot',
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
    const tally = (values: string[]) =>
      values.reduce<Record<string, number>>((result, value) => {
        result[value] = (result[value] ?? 0) + 1;
        return result;
      }, {});
    const pinResets = visible.filter(
      (ticket) => ticket.queryType === 'PIN_RESET',
    );
    const pinResetHandled = pinResets.filter(
      (ticket) => ticket.details.executedAt,
    );
    const withinSla = pinResetHandled.filter(
      (ticket) =>
        ticket.slaDueAt &&
        new Date(ticket.details.executedAt!).getTime() <=
          new Date(ticket.slaDueAt).getTime(),
    );
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
      slaBreachedOpen: visible.filter(
        (ticket) =>
          !CLOSED_STATES.includes(ticket.status) &&
          ticket.slaDueAt &&
          new Date(ticket.slaDueAt).getTime() < now,
      ).length,
      pinResetsHandled: pinResetHandled.length,
      pinResetsWithinSla: withinSla.length,
      byQueryType: tally(
        visible.map((ticket) => ticket.queryTypeLabel ?? 'Not selected'),
      ),
      outcomes: tally(
        visible
          .filter((ticket) => ticket.outcome)
          .map((ticket) => ticket.outcome!),
      ),
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
      ['by_query_type', JSON.stringify(report.byQueryType)],
      ['outcomes', JSON.stringify(report.outcomes)],
      [
        'assignment_distribution',
        JSON.stringify(report.assignmentDistribution),
      ],
      ['cases_by_region', JSON.stringify(report.casesByRegion)],
      ['inbound_by_date', JSON.stringify(report.inboundByDate)],
      ['outbound_by_date', JSON.stringify(report.outboundByDate)],
    ];
    await this.audits.recordNow(null, user, 'REPORT_EXPORTED', {
      report: 'summary',
    });
    return toCsv(rows);
  }

  /** The SOP's "GSM Back Office daily log" (Step 6), for one Lusaka calendar day. */
  async dailyLogCsv(role: string, user: string, date?: string) {
    if (!isPrivileged(role))
      throw new ForbiddenException('Supervisor authorisation required');
    const day =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : new Date(Date.now() + LUSAKA_OFFSET_MS).toISOString().slice(0, 10);
    const start = new Date(
      new Date(`${day}T00:00:00.000Z`).getTime() - LUSAKA_OFFSET_MS,
    );
    const end = new Date(start.getTime() + 24 * 3600_000);
    const visible = await this.visible(role, user, {
      createdAt: { gte: start, lt: end },
      queryType: { not: null },
    });
    const local = (iso: string | null | undefined) =>
      iso
        ? new Date(new Date(iso).getTime() + LUSAKA_OFFSET_MS)
            .toISOString()
            .slice(11, 16)
        : '';
    const rows = [
      [
        'Date',
        'Time of Pickup',
        'Time of Execution',
        'MSISDN',
        'NRC Number',
        'Request Type',
        'Region / Province',
        'Location Name',
        'Shop Type',
        'Agent Who Escalated',
        'Resolved (Yes / No)',
        'Comment / Reason',
        'Reference',
        'Handled By',
      ],
      ...visible
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((ticket) => {
          const d = ticket.details;
          const resolved = ticket.status === 'RESOLVED';
          const open =
            !CLOSED_STATES.includes(ticket.status) &&
            ticket.status !== 'ESCALATED';
          return [
            day,
            local(ticket.acknowledgedAt),
            local(d.executedAt ?? ticket.resolvedAt ?? ticket.closedAt),
            d.msisdn ?? '',
            d.nrcNumber ?? '',
            ticket.queryTypeLabel ?? '',
            d.region || ticket.agent.region || '',
            d.locationName || ticket.agent.storeName || '',
            d.shopType || ticket.agent.shopType || '',
            ticket.agent.phone,
            open ? 'Open' : resolved ? 'Yes' : 'No',
            resolved ? '' : (ticket.outcome ?? (open ? 'In progress' : '')),
            ticket.reference,
            ticket.assignedUserId ?? '',
          ];
        }),
    ];
    await this.audits.recordNow(null, user, 'REPORT_EXPORTED', {
      report: 'daily-log',
      day,
      rows: rows.length - 1,
    });
    return { day, csv: toCsv(rows) };
  }
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','),
    )
    .join('\n');
}
