import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { type Actor, CurrentActor, Public } from './auth';
import { MessagingService } from './messaging.service';
import { requirePermission } from './permissions';
import { validSignature } from './whatsapp';

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly audits: AuditService,
  ) {}

  // ---------- Meta webhook ----------

  /** Meta's one-time subscription check when the webhook URL is configured. */
  @Public()
  @SkipThrottle()
  @Get('webhooks/whatsapp')
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected = process.env.META_VERIFY_TOKEN ?? '';
    if (mode === 'subscribe' && expected && token && sameText(token, expected))
      return challenge ?? '';
    throw new ForbiddenException('Verification failed');
  }

  /** Meta delivers messages and status receipts here, signed with the app secret. */
  @Public()
  @SkipThrottle()
  @Post('webhooks/whatsapp')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = process.env.META_APP_SECRET ?? '';
    if (!secret) throw new NotFoundException();
    if (!validSignature(req.rawBody, signature, secret))
      throw new UnauthorizedException('Invalid signature');
    return this.messaging.receiveWebhook(body);
  }

  // ---------- operations (supervisors) ----------

  @Get('api/operations')
  operations(@CurrentActor() actor: Actor) {
    return this.messaging.operations(actor);
  }

  @Post('api/operations/outbound/:id/retry')
  retryOutbound(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.messaging.retryOutbound(actor, id);
  }

  @Post('api/operations/outbound/:id/dismiss')
  dismissOutbound(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.messaging.dismissOutbound(actor, id);
  }

  @Post('api/operations/inbound/:id/retry')
  retryInbound(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.messaging.retryInbound(actor, id);
  }

  /** Re-computes the audit hash chain. Supervisors and administrators only. */
  @Get('api/audit/verify')
  async verifyAudit(@CurrentActor() actor: Actor) {
    requirePermission(actor, 'audit.verify');
    const result = await this.audits.verify();
    await this.audits.recordNow(null, actor.id, 'AUDIT_CHAIN_VERIFIED', {
      checked: result.checked,
      intact: result.brokenAt === null,
    });
    return { ...result, intact: result.brokenAt === null };
  }
}
