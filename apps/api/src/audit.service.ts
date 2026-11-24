import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

// Serialises writers to the audit hash chain (and ticket reference numbering).
const AUDIT_LOCK_KEY = 7342001;

/**
 * Hash format version, stored in each event's metadata as `_v`. Version 2 hashes a
 * key-sorted JSON encoding, because PostgreSQL jsonb does not keep key order and the
 * chain must be re-computable from what is stored. Events without `_v` predate this
 * and can only have their links (previousHash) verified.
 */
const HASH_VERSION = 2;

/** JSON with object keys sorted at every level, so encoding is order-independent. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

const chainHash = (
  previousHash: string | null,
  actor: string,
  type: string,
  payload: unknown,
  ticketId: string | null,
  createdAt: Date,
) =>
  createHash('sha256')
    .update(
      `${previousHash ?? ''}|${actor}|${type}|${canonicalJson(payload)}|${ticketId ?? ''}|${createdAt.toISOString()}`,
    )
    .digest('hex');

/**
 * The tamper-evident audit log: every event's hash covers the previous event's
 * hash, so editing or deleting a past event breaks the chain from that point on.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Takes the chain lock for the rest of the transaction. */
  async lock(tx: Tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  }

  /**
   * Appends an event. Call inside a transaction that has taken lock().
   * `actor` is a staff keycloakId, or "system" / "bot".
   */
  async record(
    tx: Tx,
    ticketId: string | null,
    actor: string,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    const actorUser =
      actor === 'system' || actor === 'bot'
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
    // Round-trip through JSON so the hashed form equals what jsonb will store
    // (drops undefined, turns Dates into strings).
    const payload = JSON.parse(
      JSON.stringify({ ...metadata, actor, _v: HASH_VERSION }),
    ) as Record<string, unknown>;
    await tx.auditEvent.create({
      data: {
        ticketId,
        actorId: actorUser?.id ?? null,
        eventType: type,
        metadata: payload as Prisma.InputJsonValue,
        hash: chainHash(previous?.hash ?? null, actor, type, payload, ticketId, createdAt),
        previousHash: previous?.hash ?? null,
        createdAt,
      },
    });
  }

  /** Records one event in its own locked transaction. */
  async recordNow(
    ticketId: string | null,
    actor: string,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      await this.record(tx, ticketId, actor, type, metadata);
    });
  }

  /**
   * Re-computes every hash in order. Returns the first broken event, if any.
   * Streams in pages so it works on large logs.
   */
  async verify(): Promise<{
    checked: number;
    /** Older events whose contents can't be re-hashed; only their links were checked. */
    linkOnly: number;
    brokenAt: string | null;
    reason?: string;
  }> {
    let previousHash: string | null = null;
    let checked = 0;
    let linkOnly = 0;
    let cursor: { createdAt: Date; id: string } | null = null;
    for (;;) {
      const page: Array<{
        id: string;
        ticketId: string | null;
        eventType: string;
        metadata: Prisma.JsonValue;
        hash: string;
        previousHash: string | null;
        createdAt: Date;
      }> = await this.prisma.auditEvent.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        ...(cursor
          ? {
              where: {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            }
          : {}),
      });
      if (!page.length) break;
      for (const event of page) {
        if (event.previousHash !== previousHash)
          return {
            checked,
            linkOnly,
            brokenAt: event.id,
            reason: 'previousHash does not match the prior event',
          };
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        if (metadata._v === HASH_VERSION) {
          const actor =
            typeof metadata.actor === 'string' ? metadata.actor : '';
          const expected = chainHash(
            previousHash,
            actor,
            event.eventType,
            metadata,
            event.ticketId,
            event.createdAt,
          );
          if (expected !== event.hash)
            return {
              checked,
              linkOnly,
              brokenAt: event.id,
              reason: 'hash does not match the event contents',
            };
        } else linkOnly++;
        previousHash = event.hash;
        checked++;
      }
      const last = page[page.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return { checked, linkOnly, brokenAt: null };
  }
}
