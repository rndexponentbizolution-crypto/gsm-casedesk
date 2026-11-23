import { createHmac } from 'node:crypto';
import { canonicalJson } from './audit.service';
import { validateConfig } from './config';
import { backoffMs } from './messaging.service';
import {
  MetaClient,
  MetaError,
  parseWebhook,
  textMessage,
  validSignature,
} from './whatsapp';

const SECRET = 'app-secret';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const webhook = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value }] }],
});

describe('validSignature', () => {
  const body = '{"object":"whatsapp_business_account"}';
  it('accepts the HMAC of the exact raw body', () => {
    expect(validSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });
  it('rejects a different body, a different secret, or a malformed header', () => {
    expect(validSignature(Buffer.from(`${body} `), sign(body), SECRET)).toBe(false);
    expect(validSignature(Buffer.from(body), sign(body, 'other'), SECRET)).toBe(false);
    expect(validSignature(Buffer.from(body), 'sha256=abc', SECRET)).toBe(false);
    expect(validSignature(Buffer.from(body), undefined, SECRET)).toBe(false);
    expect(validSignature(undefined, sign(body), SECRET)).toBe(false);
    expect(validSignature(Buffer.from(body), sign(body, ''), '')).toBe(false);
  });
});

describe('parseWebhook', () => {
  it('reads text, list replies and media, normalising the sender to +E.164', () => {
    const { messages } = parseWebhook(
      webhook({
        metadata: { phone_number_id: 'PN1' },
        messages: [
          { from: '260970000001', id: 'wamid.1', type: 'text', text: { body: 'Hi' } },
          {
            from: '260970000001',
            id: 'wamid.2',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'PIN_RESET', title: 'PIN reset' } },
          },
          {
            from: '260970000001',
            id: 'wamid.3',
            type: 'document',
            document: { id: 'MEDIA1', mime_type: 'application/pdf', filename: 'nrc.pdf', caption: 'NRC' },
          },
        ],
      }),
      'PN1',
    );
    expect(messages).toEqual([
      { id: 'wamid.1', phone: '+260970000001', type: 'text', text: 'Hi' },
      { id: 'wamid.2', phone: '+260970000001', type: 'interactive', replyId: 'PIN_RESET', text: 'PIN reset' },
      {
        id: 'wamid.3',
        phone: '+260970000001',
        type: 'document',
        text: 'NRC',
        media: { id: 'MEDIA1', mimeType: 'application/pdf', filename: 'nrc.pdf', caption: 'NRC' },
      },
    ]);
  });

  it('reads delivery statuses with their errors', () => {
    const { statuses } = parseWebhook(
      webhook({
        statuses: [
          { id: 'wamid.9', status: 'delivered' },
          { id: 'wamid.8', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] },
          { id: 'wamid.7', status: 'deleted' },
        ],
      }),
    );
    expect(statuses).toEqual([
      { id: 'wamid.9', status: 'delivered', error: '' },
      { id: 'wamid.8', status: 'failed', error: '131047 Re-engagement message' },
    ]);
  });

  it('ignores other phone numbers, other objects and junk', () => {
    const other = webhook({
      metadata: { phone_number_id: 'OTHER' },
      messages: [{ from: '1', id: 'x', type: 'text', text: { body: 'no' } }],
    });
    expect(parseWebhook(other, 'PN1').messages).toHaveLength(0);
    expect(parseWebhook({ object: 'page' }).messages).toHaveLength(0);
    expect(parseWebhook(null).messages).toHaveLength(0);
    expect(parseWebhook(webhook({ messages: [{ type: 'text' }] })).messages).toHaveLength(0);
  });
});

describe('textMessage', () => {
  it('sends plain text with links not previewed', () => {
    expect(textMessage({ kind: 'text', to: '+260 97 0000001', body: 'Hello' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '260970000001',
      type: 'text',
      text: { body: 'Hello', preview_url: false },
    });
  });

  it('turns the bot menu into a WhatsApp list within its limits', () => {
    const message = textMessage({
      kind: 'text',
      to: '+260970000001',
      body: 'Choose',
      interactive: {
        type: 'list',
        button: 'Select',
        options: Array.from({ length: 12 }, (_, i) => ({ id: `O${i}`, title: `Option with a long title ${i}` })),
      },
    }) as { type: string; interactive: { action: { sections: Array<{ rows: Array<{ title: string }> }> } } };
    expect(message.type).toBe('interactive');
    const rows = message.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.title.length <= 24)).toBe(true);
  });
});

describe('MetaError', () => {
  it('treats rate limits and throttling as retryable, other 4xx as permanent', () => {
    expect(new MetaError('x', 429).permanent).toBe(false);
    expect(new MetaError('x', 400, 130429).permanent).toBe(false);
    expect(new MetaError('x', 400, 131047).permanent).toBe(true);
    expect(new MetaError('x', 401, 190).permanent).toBe(true);
    expect(new MetaError('x', 500).permanent).toBe(false);
  });
});

describe('MetaClient', () => {
  it('sends to the phone number endpoint and returns the wamid', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fake = ((url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] })));
    }) as unknown as typeof fetch;
    const client = new MetaClient('TOKEN', 'PN1', 'v22.0', fake);
    await expect(client.send({ to: '1' })).resolves.toBe('wamid.X');
    expect(calls[0][0]).toBe('https://graph.facebook.com/v22.0/PN1/messages');
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
  });

  it('raises MetaError with Meta\'s error code', async () => {
    const fake = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Re-engagement', code: 131047 } }), { status: 400 }),
      )) as unknown as typeof fetch;
    const error = (await new MetaClient('T', 'PN1', 'v22.0', fake).send({}).catch((e: unknown) => e)) as MetaError;
    expect(error).toBeInstanceOf(MetaError);
    expect(error.code).toBe(131047);
    expect(error.permanent).toBe(true);
  });
});

describe('backoffMs', () => {
  it('doubles from 5 seconds and caps at 10 minutes', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([5000, 10000, 20000]);
    expect(backoffMs(20)).toBe(600000);
  });
});

describe('canonicalJson', () => {
  it('encodes the same object identically whatever its key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
  });
});

describe('validateConfig', () => {
  const base = { NODE_ENV: 'production', AUTH_MODE: 'keycloak', WEB_ORIGIN: 'https://casedesk.example' };
  it('defaults to simulation', () => {
    expect(validateConfig({ ...base }).mode).toBe('simulation');
  });
  it('requires Meta credentials and storage for live WhatsApp', () => {
    expect(() => validateConfig({ ...base, SIMULATION_ENABLED: 'false' })).toThrow(
      /META_APP_SECRET, META_VERIFY_TOKEN, META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, S3_BUCKET/,
    );
    const live = validateConfig({
      ...base,
      SIMULATION_ENABLED: 'false',
      META_APP_SECRET: 's',
      META_VERIFY_TOKEN: 'v',
      META_ACCESS_TOKEN: 'a',
      META_PHONE_NUMBER_ID: 'p',
      S3_BUCKET: 'b',
    });
    expect(live.mode).toBe('live');
    expect(live.warnings.join()).toMatch(/CLAMAV_HOST/);
  });
  it('refuses demo sign-in and development storage keys in production', () => {
    expect(() => validateConfig({ ...base, AUTH_MODE: 'demo' })).toThrow(/AUTH_MODE=demo/);
    expect(() => validateConfig({ ...base, S3_SECRET_KEY: 'change-me' })).toThrow(/development defaults/);
  });
  it('warns when CORS has no production origin', () => {
    expect(validateConfig({ NODE_ENV: 'production' }).warnings.join()).toMatch(/WEB_ORIGIN/);
  });
});
