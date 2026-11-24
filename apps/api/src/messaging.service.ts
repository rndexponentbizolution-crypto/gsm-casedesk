import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MessageState, Prisma } from '@prisma/client';
import { type Access, requirePermission } from './permissions';
import { AppService, mediaKind, STUCK_AFTER_MS } from './app.service';
import { AuditService } from './audit.service';
import { messagingMode } from './config';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage';
import {
  type InboundMessage,
  MetaClient,
  MetaError,
  type OutboundPayload,
  parseWebhook,
  type StatusUpdate,
  textMessage,
} from './whatsapp';

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const BATCH = 10;
export const MAX_OUTBOUND_ATTEMPTS = 6;
export const MAX_INBOUND_ATTEMPTS = 5;
/** A claim older than this means the worker died mid-way. */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** Exponential backoff: 5s, 10s, 20s ... capped at 10 minutes. */
export const backoffMs = (attempt: number) =>
  Math.min(5000 * 2 ** Math.max(0, attempt - 1), 10 * 60 * 1000);

const STATE_RANK: Record<MessageState, number> = {
  PENDING: 0,
  AMBIGUOUS: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

type OutboxRow = {
  id: string;
  messageId: string;
  payload: Prisma.JsonValue;
  retryCount: number;
};
type InboundRow = {
  id: string;
  providerId: string;
  rawPayload: Prisma.JsonValue;
  retryCount: number;
  createdAt: Date;
};

/**
 * Live WhatsApp plumbing: takes in Meta webhooks, processes stored inbound events,
 * delivers the outbox to Meta, and gives supervisors a view of failed/stuck work
 * with retry and dismiss actions.
 *
 * Workers only run in live mode (SIMULATION_ENABLED=false) unless WORKERS_ENABLED=false.
 * Claims use SELECT ... FOR UPDATE SKIP LOCKED, so several API instances can share the work.
 */
@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Messaging');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audits: AuditService,
    private readonly app: AppService,
    private readonly storage: StorageService,
    readonly meta: MetaClient,
  ) {}

  onModuleInit() {
    if (messagingMode() !== 'live' || process.env.WORKERS_ENABLED === 'false')
      return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    this.log.log(`Live WhatsApp workers polling every ${POLL_MS} ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass of all workers. Safe to call any time; overlapping calls are skipped. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverStale();
      await this.processInbound();
      await this.processOutbox();
    } catch (error) {
      this.log.error(`Worker pass failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ---------- webhook intake ----------

  /**
   * Stores each inbound message as an event (duplicates from Meta's retries are
   * dropped by the unique providerId) and applies delivery statuses. Processing
   * happens afterwards, so Meta always gets a fast 200.
   */
  async receiveWebhook(payload: unknown) {
    const { messages, statuses } = parseWebhook(
      payload,
      process.env.META_PHONE_NUMBER_ID,
    );
    if (messages.length)
      await this.prisma.inboundWebhookEvent.createMany({
        data: messages.map((message) => ({
          providerId: message.id,
          rawPayload: message as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    for (const status of statuses) await this.applyStatus(status);
    if (messages.length && this.timer) setImmediate(() => void this.tick());
    return { messages: messages.length, statuses: statuses.length };
  }

  /** Moves a sent message's state forward (never backwards) from a Meta receipt. */
  async applyStatus(update: StatusUpdate) {
    const message = await this.prisma.message.findUnique({
      where: { providerId: update.id },
    });
    if (!message) return;
    const next: MessageState =
      update.status === 'failed'
        ? 'FAILED'
        : (update.status.toUpperCase() as MessageState);
    if (STATE_RANK[next] <= STATE_RANK[message.state]) return;
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      await tx.message.update({
        where: { id: message.id },
        data: { state: next },
      });
      if (next === 'FAILED') {
        await tx.outboundMessageOutbox.updateMany({
          where: { messageId: message.id },
          data: { status: 'FAILED', error: update.error || 'Meta reported failure' },
        });
        await this.audits.record(tx, message.ticketId, 'system', 'MESSAGE_FAILED', {
          messageId: message.id,
          error: update.error || 'Meta reported failure',
          stage: 'delivery',
        });
      }
    });
  }

  // ---------- inbound processing ----------

  async processInbound() {
    const rows = await this.prisma.$queryRaw<InboundRow[]>`
      UPDATE "InboundWebhookEvent" SET status = 'PROCESSING', "lockedAt" = now()
      WHERE id IN (
        SELECT id FROM "InboundWebhookEvent"
        WHERE status = 'RECEIVED' AND "nextAttemptAt" <= now()
        ORDER BY "createdAt" LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, "providerId", "rawPayload", "retryCount", "createdAt"`;
    // Oldest first, so a conversation's messages are handled in order.
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const row of rows) await this.handleInboundRow(row);
  }

  private async handleInboundRow(row: InboundRow) {
    const message = row.rawPayload as unknown as InboundMessage;
    try {
      let media;
      if (message.media) {
        const download = await this.meta.downloadMedia(message.media.id);
        const stored = await this.app.storeFile(
          download.body,
          message.media.filename ?? `${message.type}-${message.media.id}`,
          message.media.mimeType || download.mimeType,
        );
        media = { ...stored, providerMediaId: message.media.id };
      }
      await this.app.handleInbound(
        {
          phone: message.phone,
          text: message.text,
          replyId: message.replyId,
          providerId: message.id,
          mediaType: message.media ? mediaKind(message.media.mimeType) : undefined,
          media,
        },
        false,
      );
      await this.prisma.inboundWebhookEvent.update({
        where: { id: row.id },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null, lockedAt: null },
      });
    } catch (error) {
      const text = (error as Error).message;
      if (error instanceof BadRequestException && /not a registered field agent/.test(text)) {
        // Someone who isn't a field agent messaged the number: nothing to retry.
        await this.prisma.inboundWebhookEvent.update({
          where: { id: row.id },
          data: { status: 'IGNORED', error: text, processedAt: new Date(), lockedAt: null },
        });
        return;
      }
      const attempts = row.retryCount + 1;
      const giveUp = attempts >= MAX_INBOUND_ATTEMPTS;
      await this.prisma.inboundWebhookEvent.update({
        where: { id: row.id },
        data: {
          status: giveUp ? 'FAILED' : 'RECEIVED',
          retryCount: attempts,
          error: text.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          lockedAt: null,
        },
      });
      this.log.warn(`Inbound ${row.providerId} attempt ${attempts} failed: ${text}`);
    }
  }

  // ---------- outbox delivery ----------

  async processOutbox() {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "OutboundMessageOutbox" SET status = 'SENDING', "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM "OutboundMessageOutbox"
        WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "createdAt" LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, "messageId", payload, "retryCount"`;
    const created = new Map(
      (
        await this.prisma.message.findMany({
          where: { id: { in: rows.map((row) => row.messageId) } },
          select: { id: true, createdAt: true },
        })
      ).map((message) => [message.id, message.createdAt.getTime()]),
    );
    // Send in creation order so a conversation reads correctly.
    rows.sort((a, b) => (created.get(a.messageId) ?? 0) - (created.get(b.messageId) ?? 0));
    for (const row of rows) await this.deliver(row);
  }

  private async send(payload: OutboundPayload) {
    if (payload.kind === 'text') return this.meta.send(textMessage(payload));
    const file = await this.storage.get(payload.storageKey);
    const mediaId = await this.meta.uploadMedia(file, payload.mimeType, payload.filename);
    const media: Record<string, string> = { id: mediaId };
    if (payload.caption && payload.mediaType !== 'audio') media.caption = payload.caption;
    if (payload.mediaType === 'document') media.filename = payload.filename;
    return this.meta.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.to.replace(/\D/g, ''),
      type: payload.mediaType,
      [payload.mediaType]: media,
    });
  }

  private async deliver(row: OutboxRow) {
    const payload = row.payload as unknown as OutboundPayload;
    try {
      const wamid = await this.send(payload);
      await this.prisma.$transaction(async (tx) => {
        await this.audits.lock(tx);
        const message = await tx.message.update({
          where: { id: row.messageId },
          data: { state: 'SENT', providerId: wamid },
        });
        await tx.outboundMessageOutbox.update({
          where: { id: row.id },
          data: { status: 'SENT', providerId: wamid, error: null },
        });
        await this.audits.record(tx, message.ticketId, 'system', 'MESSAGE_SENT', {
          messageId: message.id,
          provider: 'meta',
          attempts: row.retryCount + 1,
        });
      });
    } catch (error) {
      const text = (error as Error).message.slice(0, 500);
      const attempts = row.retryCount + 1;
      const permanent = error instanceof MetaError && error.permanent;
      if (permanent || attempts >= MAX_OUTBOUND_ATTEMPTS) {
        await this.prisma.$transaction(async (tx) => {
          await this.audits.lock(tx);
          const message = await tx.message.update({
            where: { id: row.messageId },
            data: { state: 'FAILED' },
          });
          await tx.outboundMessageOutbox.update({
            where: { id: row.id },
            data: { status: 'FAILED', retryCount: attempts, error: text },
          });
          await this.audits.record(tx, message.ticketId, 'system', 'MESSAGE_FAILED', {
            messageId: message.id,
            error: text,
            attempts,
            permanent,
          });
        });
      } else {
        await this.prisma.outboundMessageOutbox.update({
          where: { id: row.id },
          data: {
            status: 'PENDING',
            retryCount: attempts,
            error: text,
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        });
      }
      this.log.warn(`Outbound ${row.messageId} attempt ${attempts} failed: ${text}`);
    }
  }

  /** Recovers work claimed by a worker that died. */
  async recoverStale() {
    const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MS);
    // Inbound processing is idempotent (messages de-duplicate on providerId): retry.
    await this.prisma.inboundWebhookEvent.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: cutoff } },
      data: { status: 'RECEIVED', lockedAt: null, nextAttemptAt: new Date() },
    });
    // An interrupted send may already have reached the field agent. Re-sending
    // could duplicate it, so a person decides.
    const stale = await this.prisma.outboundMessageOutbox.findMany({
      where: { status: 'SENDING', updatedAt: { lt: cutoff } },
    });
    for (const row of stale)
      await this.prisma.$transaction(async (tx) => {
        await this.audits.lock(tx);
        const message = await tx.message.update({
          where: { id: row.messageId },
          data: { state: 'AMBIGUOUS' },
        });
        await tx.outboundMessageOutbox.update({
          where: { id: row.id },
          data: { status: 'AMBIGUOUS', error: 'Interrupted while sending; delivery unknown' },
        });
        await this.audits.record(tx, message.ticketId, 'system', 'MESSAGE_AMBIGUOUS', {
          messageId: message.id,
        });
      });
  }

  // ---------- operations (supervisors) ----------

  /** Failed, ambiguous, retrying and stuck work, newest first. */
  async operations(actor: Access) {
    requirePermission(actor, 'operations.manage');
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS);
    const [outbound, inbound] = await Promise.all([
      this.prisma.outboundMessageOutbox.findMany({
        where: {
          OR: [
            { status: { in: ['FAILED', 'AMBIGUOUS'] } },
            { status: 'PENDING', retryCount: { gt: 0 } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.inboundWebhookEvent.findMany({
        where: {
          OR: [
            { status: 'FAILED' },
            { status: { in: ['RECEIVED', 'PROCESSING'] }, createdAt: { lt: stuckBefore } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const messages = await this.prisma.message.findMany({
      where: { id: { in: outbound.map((row) => row.messageId) } },
      include: { ticket: { select: { id: true, reference: true } } },
    });
    const byId = new Map(messages.map((message) => [message.id, message]));
    return {
      mode: messagingMode(),
      outbound: outbound.map((row) => {
        const message = byId.get(row.messageId);
        const payload = row.payload as unknown as OutboundPayload;
        return {
          id: row.id,
          status: row.status,
          attempts: row.retryCount,
          error: row.error,
          nextAttemptAt: row.status === 'PENDING' ? row.nextAttemptAt.toISOString() : null,
          updatedAt: row.updatedAt.toISOString(),
          to: payload?.to ?? null,
          preview:
            payload?.kind === 'media'
              ? `[${payload.mediaType}] ${payload.filename}`
              : (message?.body ?? '').slice(0, 120),
          ticketId: message?.ticket.id ?? null,
          reference: message?.ticket.reference ?? null,
        };
      }),
      inbound: inbound.map((row) => {
        const message = row.rawPayload as unknown as InboundMessage;
        return {
          id: row.id,
          status: row.status,
          attempts: row.retryCount,
          error: row.error,
          from: message?.phone ?? null,
          type: message?.type ?? null,
          preview: (message?.text ?? '').slice(0, 120),
          receivedAt: row.createdAt.toISOString(),
        };
      }),
    };
  }

  async retryOutbound(actor: Access, id: string) {
    requirePermission(actor, 'operations.manage');
    const user = actor.id;
    const row = await this.prisma.outboundMessageOutbox.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Outbound message not found');
    if (!['FAILED', 'AMBIGUOUS'].includes(row.status))
      throw new BadRequestException(`Only failed or ambiguous sends can be retried (this one is ${row.status})`);
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      const message = await tx.message.update({
        where: { id: row.messageId },
        data: { state: 'PENDING' },
      });
      await tx.outboundMessageOutbox.update({
        where: { id },
        data: { status: 'PENDING', retryCount: 0, nextAttemptAt: new Date() },
      });
      await this.audits.record(tx, message.ticketId, user, 'OUTBOUND_RETRIED', {
        messageId: message.id,
        previousStatus: row.status,
        previousError: row.error,
      });
    });
    return { id, status: 'PENDING' };
  }

  async dismissOutbound(actor: Access, id: string) {
    requirePermission(actor, 'operations.manage');
    const user = actor.id;
    const row = await this.prisma.outboundMessageOutbox.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Outbound message not found');
    if (!['FAILED', 'AMBIGUOUS'].includes(row.status))
      throw new BadRequestException(`Only failed or ambiguous sends can be dismissed (this one is ${row.status})`);
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      const message = await tx.message.findUniqueOrThrow({ where: { id: row.messageId } });
      await tx.outboundMessageOutbox.update({ where: { id }, data: { status: 'DISMISSED' } });
      await this.audits.record(tx, message.ticketId, user, 'OUTBOUND_DISMISSED', {
        messageId: message.id,
        previousStatus: row.status,
      });
    });
    return { id, status: 'DISMISSED' };
  }

  async retryInbound(actor: Access, id: string) {
    requirePermission(actor, 'operations.manage');
    const user = actor.id;
    const row = await this.prisma.inboundWebhookEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Inbound event not found');
    if (row.status === 'PROCESSED')
      throw new BadRequestException('This message was already processed');
    await this.prisma.$transaction(async (tx) => {
      await this.audits.lock(tx);
      await tx.inboundWebhookEvent.update({
        where: { id },
        data: { status: 'RECEIVED', retryCount: 0, nextAttemptAt: new Date(), lockedAt: null },
      });
      await this.audits.record(tx, null, user, 'INBOUND_RETRIED', {
        eventId: id,
        providerId: row.providerId,
        previousStatus: row.status,
        previousError: row.error,
      });
    });
    return { id, status: 'RECEIVED' };
  }
}
