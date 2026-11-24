import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AdminService,
  type FieldAgentInput,
  type StaffInput,
} from './admin.service';
import { type Actor, CurrentActor } from './auth';

@Controller('api')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ---------- staff (staff.manage) ----------

  /** Permission catalogue and role defaults, for the admin screens. */
  @Get('staff/permissions')
  catalog(@CurrentActor() actor: Actor) {
    return this.admin.catalog(actor);
  }

  @Get('staff')
  listStaff(@CurrentActor() actor: Actor) {
    return this.admin.listStaff(actor);
  }

  /** Creates the account; the response carries a one-time temporary password. */
  @Post('staff')
  createStaff(@CurrentActor() actor: Actor, @Body() body: StaffInput) {
    return this.admin.createStaff(actor, body ?? {});
  }

  @Patch('staff/:id')
  updateStaff(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: StaffInput,
  ) {
    return this.admin.updateStaff(actor, id, body ?? {});
  }

  @Post('staff/:id/reset-password')
  resetPassword(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.admin.resetPassword(actor, id);
  }

  // ---------- field agents ----------

  /** Any signed-in staff member can look agents up. */
  @Get('field-agents')
  fieldAgents() {
    return this.admin.listFieldAgents();
  }

  @Post('field-agents')
  createFieldAgent(@CurrentActor() actor: Actor, @Body() body: FieldAgentInput) {
    return this.admin.createFieldAgent(actor, body ?? {});
  }

  @Patch('field-agents/:id')
  updateFieldAgent(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: FieldAgentInput,
  ) {
    return this.admin.updateFieldAgent(actor, id, body ?? {});
  }
}
