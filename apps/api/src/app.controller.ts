import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AppService } from './app.service';
import { type Actor, CurrentActor, Public } from './auth';

@Controller()
export class AppController {
  constructor(private readonly app: AppService) {}

  @Public()
  @Get('health')
  async health() {
    const database = (await this.app.databaseReachable()) ? 'ok' : 'error';
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      mode:
        process.env.SIMULATION_ENABLED === 'false'
          ? 'live-ready'
          : 'simulation',
      timestamp: new Date().toISOString(),
    };
  }

  /** The signed-in user, as CaseDesk knows them. */
  @Get('api/me')
  me(@CurrentActor() actor: Actor) {
    return actor;
  }

  @Get('api/dashboard')
  dashboard(@CurrentActor() actor: Actor) {
    return this.app.dashboard(actor.role, actor.id);
  }

  @Get('api/tickets')
  tickets(@CurrentActor() actor: Actor, @Query('status') status?: string) {
    return this.app.tickets(actor.role, actor.id, status);
  }

  @Get('api/tickets/:id')
  async ticket(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const ticket = await this.app.ticket(actor.role, actor.id, id);
    if (!ticket)
      throw new BadRequestException('Ticket not found or not authorised');
    return ticket;
  }

  @Post('api/tickets/:id/reply')
  reply(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { text?: string; templateId?: string },
  ) {
    return this.app.reply(actor.role, actor.id, id, body.text, body.templateId);
  }

  @Patch('api/tickets/:id/case')
  updateCase(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { queryType?: string; details?: Record<string, unknown> },
  ) {
    return this.app.updateCase(actor.role, actor.id, id, body ?? {});
  }

  @Get('api/query-types')
  queryTypes() {
    return this.app.queryTypes();
  }

  @Get('api/responses')
  responses() {
    return this.app.responses();
  }

  @Post('api/tickets/:id/reassign')
  reassign(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.app.reassign(actor.role, actor.id, id, body.userId);
  }

  @Post('api/tickets/:id/status')
  status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.app.changeStatus(actor.role, actor.id, id, body.status);
  }

  @Post('api/simulator/inbound')
  simulateInbound(
    @Body()
    body: {
      phone: string;
      text?: string;
      mediaType?: string;
      duplicate?: boolean;
      providerId?: string;
      replyId?: string;
    },
  ) {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.SIMULATION_ENABLED !== 'true'
    ) {
      throw new BadRequestException('Simulator unavailable');
    }
    if (!body.phone || (!body.text && !body.mediaType && !body.replyId))
      throw new BadRequestException('phone and message content are required');
    return this.app.simulateInbound(body);
  }

  @Get('api/field-agents')
  fieldAgents() {
    return this.app.fieldAgents();
  }

  @Get('api/reports')
  reports(@CurrentActor() actor: Actor) {
    return this.app.reports(actor.role, actor.id);
  }

  @Get('api/reports.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="gsm-casedesk-report.csv"',
  )
  reportCsv(@CurrentActor() actor: Actor) {
    return this.app.reportCsv(actor.role, actor.id);
  }

  /** SOP Step 6 daily log for one day (YYYY-MM-DD, Lusaka time; defaults to today). */
  @Get('api/reports/daily-log.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="gsm-daily-log.csv"')
  async dailyLog(@CurrentActor() actor: Actor, @Query('date') date?: string) {
    return (await this.app.dailyLogCsv(actor.role, actor.id, date)).csv;
  }
}
