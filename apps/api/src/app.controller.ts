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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService, MAX_MEDIA_BYTES } from './app.service';
import { type Actor, CurrentActor, Public } from './auth';
import { messagingMode } from './config';

const upload = FileInterceptor('file', {
  limits: { fileSize: MAX_MEDIA_BYTES, files: 1 },
});

/** RFC 6266 filename, safe for any characters. */
const disposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

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
      mode: messagingMode(),
      timestamp: new Date().toISOString(),
    };
  }

  /** The signed-in user, as CaseDesk knows them, with their effective permissions. */
  @Get('api/me')
  me(@CurrentActor() actor: Actor) {
    return actor;
  }

  @Get('api/dashboard')
  dashboard(@CurrentActor() actor: Actor) {
    return this.app.dashboard(actor);
  }

  @Get('api/tickets')
  tickets(@CurrentActor() actor: Actor, @Query('status') status?: string) {
    return this.app.tickets(actor, status);
  }

  @Get('api/tickets/:id')
  async ticket(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const ticket = await this.app.ticket(actor, id);
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
    return this.app.reply(actor, id, body.text, body.templateId);
  }

  /** Send a file (multipart field "file", optional "caption") to the field agent. */
  @Post('api/tickets/:id/media')
  @UseInterceptors(upload)
  sendMedia(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { caption?: string },
  ) {
    return this.app.sendMedia(actor, id, file, body?.caption);
  }

  /** Download an attachment. Always served as a download, never rendered inline. */
  @Get('api/attachments/:id')
  async attachment(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const file = await this.app.attachment(actor, id);
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: disposition(file.name),
      length: file.body.length,
    });
  }

  @Patch('api/tickets/:id/case')
  updateCase(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { queryType?: string; details?: Record<string, unknown> },
  ) {
    return this.app.updateCase(actor, id, body ?? {});
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
    return this.app.reassign(actor, id, body.userId);
  }

  @Post('api/tickets/:id/status')
  status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.app.changeStatus(actor, id, body.status);
  }

  @Get('api/reports')
  reports(@CurrentActor() actor: Actor) {
    return this.app.reports(actor);
  }

  @Get('api/reports.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="gsm-casedesk-report.csv"',
  )
  reportCsv(@CurrentActor() actor: Actor) {
    return this.app.reportCsv(actor);
  }

  /** SOP Step 6 daily log for one day (YYYY-MM-DD, Lusaka time; defaults to today). */
  @Get('api/reports/daily-log.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="gsm-daily-log.csv"')
  async dailyLog(@CurrentActor() actor: Actor, @Query('date') date?: string) {
    return (await this.app.dailyLogCsv(actor, date)).csv;
  }
}
