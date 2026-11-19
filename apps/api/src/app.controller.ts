import { BadRequestException, Body, Controller, Get, Header, Headers, Param, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly app: AppService) {}

  @Get('health')
  health() {
    return { status: 'ok', mode: process.env.SIMULATION_ENABLED === 'false' ? 'live-ready' : 'simulation', timestamp: new Date().toISOString() };
  }

  @Get('api/dashboard')
  dashboard(@Headers('x-demo-role') role = 'SUPERVISOR', @Headers('x-demo-user') user = 'demo-supervisor') {
    return this.app.dashboard(role, user);
  }

  @Get('api/tickets')
  tickets(@Headers('x-demo-role') role = 'SUPERVISOR', @Headers('x-demo-user') user = 'demo-supervisor', @Query('status') status?: string) {
    return this.app.tickets(role, user, status);
  }

  @Get('api/tickets/:id')
  async ticket(@Headers('x-demo-role') role = 'SUPERVISOR', @Headers('x-demo-user') user = 'demo-supervisor', @Param('id') id: string) {
    const ticket = await this.app.ticket(role, user, id);
    if (!ticket) throw new BadRequestException('Ticket not found or not authorised');
    return ticket;
  }

  @Post('api/tickets/:id/reply')
  reply(
    @Headers('x-demo-role') role = 'SUPERVISOR',
    @Headers('x-demo-user') user = 'demo-supervisor',
    @Param('id') id: string,
    @Body() body: { text?: string },
  ) {
    return this.app.reply(role, user, id, body.text);
  }

  @Post('api/tickets/:id/reassign')
  reassign(
    @Headers('x-demo-role') role = 'SUPERVISOR',
    @Headers('x-demo-user') user = 'demo-supervisor',
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.app.reassign(role, user, id, body.userId);
  }

  @Post('api/tickets/:id/status')
  status(
    @Headers('x-demo-role') role = 'SUPERVISOR',
    @Headers('x-demo-user') user = 'demo-supervisor',
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.app.changeStatus(role, user, id, body.status);
  }

  @Post('api/simulator/inbound')
  simulateInbound(@Body() body: { phone: string; text?: string; mediaType?: string; duplicate?: boolean; providerId?: string }) {
    if (process.env.NODE_ENV === 'production' && process.env.SIMULATION_ENABLED !== 'true') {
      throw new BadRequestException('Simulator unavailable');
    }
    if (!body.phone || (!body.text && !body.mediaType)) throw new BadRequestException('phone and message content are required');
    return this.app.simulateInbound(body);
  }

  @Get('api/field-agents')
  fieldAgents() {
    return this.app.fieldAgents();
  }

  @Get('api/reports')
  reports(@Headers('x-demo-role') role = 'SUPERVISOR', @Headers('x-demo-user') user = 'demo-supervisor') {
    return this.app.reports(role, user);
  }

  @Get('api/reports.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="gsm-casedesk-report.csv"')
  reportCsv(@Headers('x-demo-role') role = 'SUPERVISOR', @Headers('x-demo-user') user = 'demo-supervisor') {
    return this.app.reportCsv(role, user);
  }
}
