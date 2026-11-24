import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InteractiveList } from './bot';

/**
 * Meta WhatsApp Cloud API: webhook signature check, webhook parsing, and the
 * Graph API calls the outbox uses. Pure functions plus a thin fetch client, so
 * everything here is testable without Meta.
 */

// ---------- webhook signature ----------

/** Verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret). */
export function validSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------- webhook parsing ----------

export const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];

export interface InboundMessage {
  /** Meta message id (wamid...), used for de-duplication. */
  id: string;
  /** Sender's number in E.164 with a leading "+". */
  phone: string;
  type: string;
  text?: string;
  replyId?: string;
  media?: {
    id: string;
    mimeType: string;
    filename?: string;
    caption?: string;
  };
}

export interface StatusUpdate {
  /** The wamid of a message CaseDesk sent. */
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
}

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pulls messages and delivery statuses for our phone number out of a webhook body. */
export function parseWebhook(
  payload: unknown,
  phoneNumberId?: string,
): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const body = (payload ?? {}) as Obj;
  if (body.object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of asArray(body.entry)) {
    for (const change of asArray(entry?.changes)) {
      const value = (change?.value ?? {}) as Obj;
      if (
        phoneNumberId &&
        value.metadata?.phone_number_id &&
        value.metadata.phone_number_id !== phoneNumberId
      )
        continue;
      for (const message of asArray(value.messages)) {
        if (typeof message?.id !== 'string' || typeof message?.from !== 'string')
          continue;
        const parsed: InboundMessage = {
          id: message.id,
          phone: `+${String(message.from).replace(/\D/g, '')}`,
          type: String(message.type ?? 'unknown'),
        };
        if (message.type === 'text') parsed.text = message.text?.body;
        if (message.type === 'button') parsed.text = message.button?.text;
        if (message.type === 'interactive') {
          const reply =
            message.interactive?.list_reply ?? message.interactive?.button_reply;
          parsed.replyId = reply?.id;
          parsed.text = reply?.title;
        }
        if (MEDIA_TYPES.includes(message.type) && message[message.type]?.id) {
          const media = message[message.type] as Obj;
          parsed.media = {
            id: media.id,
            mimeType: media.mime_type ?? 'application/octet-stream',
            filename: media.filename,
            caption: media.caption,
          };
          parsed.text = media.caption;
        }
        messages.push(parsed);
      }
      for (const status of asArray(value.statuses)) {
        if (
          typeof status?.id === 'string' &&
          ['sent', 'delivered', 'read', 'failed'].includes(status.status)
        )
          statuses.push({
            id: status.id,
            status: status.status,
            error: asArray(status.errors)
              .map((error: Obj) =>
                [error?.code, error?.title].filter(Boolean).join(' '),
              )
              .join('; '),
          });
      }
    }
  }
  return { messages, statuses };
}

const asArray = (value: unknown): Obj[] =>
  Array.isArray(value) ? (value as Obj[]) : [];

// ---------- outbound ----------

export type OutboundPayload =
  | { kind: 'text'; to: string; body: string; interactive?: InteractiveList }
  | {
      kind: 'media';
      to: string;
      mediaType: 'image' | 'document' | 'audio' | 'video';
      storageKey: string;
      mimeType: string;
      filename: string;
      caption?: string;
    };

/** A Graph API failure. `permanent` errors are not retried automatically. */
export class MetaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
  get permanent() {
    // 429 and Meta's throttling codes are worth retrying; other 4xx are not.
    if (this.status === 429 || [4, 80007, 130429, 131048, 131056].includes(this.code ?? -1))
      return false;
    return this.status >= 400 && this.status < 500;
  }
}

/** Builds the Graph API message body for text and interactive-list messages. */
export function textMessage(payload: Extract<OutboundPayload, { kind: 'text' }>) {
  const to = payload.to.replace(/\D/g, '');
  const options = payload.interactive?.options ?? [];
  if (payload.interactive?.type === 'list' && options.length) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: payload.body.slice(0, 1024) },
        action: {
          button: payload.interactive.button.slice(0, 20),
          sections: [
            {
              title: 'Options',
              rows: options.slice(0, 10).map((option) => ({
                id: option.id,
                title: option.title.slice(0, 24),
              })),
            },
          ],
        },
      },
    };
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: payload.body.slice(0, 4096), preview_url: false },
  };
}

/** Thin client for the Graph API calls CaseDesk makes. */
export class MetaClient {
  constructor(
    private readonly accessToken = process.env.META_ACCESS_TOKEN ?? '',
    private readonly phoneNumberId = process.env.META_PHONE_NUMBER_ID ?? '',
    private readonly version = process.env.META_GRAPH_VERSION ?? 'v22.0',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.version}/${path}`;
  }

  private async call(path: string, init: RequestInit): Promise<Obj> {
    const response = await this.fetchImpl(this.url(path), {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let body: Obj = {};
    try {
      body = text ? (JSON.parse(text) as Obj) : {};
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (!response.ok) {
      const error = (body.error ?? {}) as Obj;
      throw new MetaError(
        `Meta API ${response.status}: ${error.message ?? body.raw ?? 'request failed'}`,
        response.status,
        typeof error.code === 'number' ? error.code : undefined,
      );
    }
    return body;
  }

  /** Sends a message body built by textMessage() or a media message; returns the wamid. */
  async send(message: Obj): Promise<string> {
    const body = await this.call(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    const id = (body.messages as Obj[] | undefined)?.[0]?.id;
    if (typeof id !== 'string') throw new MetaError('Meta returned no message id', 502);
    return id;
  }

  /** Uploads a file to Meta and returns its media id (valid for 30 days). */
  async uploadMedia(file: Buffer, mimeType: string, filename: string) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), filename);
    const body = await this.call(`${this.phoneNumberId}/media`, {
      method: 'POST',
      body: form,
    });
    return String(body.id);
  }

  /** Downloads an inbound media file by its Meta media id. */
  async downloadMedia(mediaId: string): Promise<{ body: Buffer; mimeType: string }> {
    const meta = await this.call(mediaId, { method: 'GET' });
    const response = await this.fetchImpl(String(meta.url), {
      headers: { authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new MetaError(`Media download failed: ${response.status}`, response.status);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      mimeType: String(meta.mime_type ?? response.headers.get('content-type') ?? 'application/octet-stream'),
    };
  }
}
