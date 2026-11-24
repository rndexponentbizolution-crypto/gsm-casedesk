import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { AuditService } from './audit.service';
import {
  KeycloakAdmin,
  KeycloakError,
  keycloakName,
  temporaryPassword,
} from './keycloak-admin';
import {
  type Access,
  ALL_PERMISSIONS,
  effectivePermissions,
  isPermission,
  PERMISSIONS,
  type Permission,
  requirePermission,
  ROLE_DEFAULTS,
  type RoleName,
} from './permissions';
import { PrismaService } from './prisma.service';

const DEFAULT_TEAM = 'Zambia Field Support';
const ROLES: RoleName[] = ['BACK_OFFICE', 'SUPERVISOR', 'ADMINISTRATOR'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164: a "+" and 8 to 15 digits. */
const PHONE = /^\+\d{8,15}$/;

export interface StaffInput {
  name?: string;
  email?: string;
  role?: string;
  grantedPermissions?: string[];
  revokedPermissions?: string[];
  active?: boolean;
  availability?: boolean;
  capacity?: number;
}

export interface FieldAgentInput {
  name?: string;
  phone?: string;
  employeeId?: string | null;
  region?: string | null;
  storeName?: string | null;
  shopType?: string | null;
  active?: boolean;
}

const text = (value: unknown, field: string, max = 120) => {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException(`${field} is required`);
  return value.trim().slice(0, max);
};
const optionalText = (value: unknown, max = 120) =>
  value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value).trim().slice(0, max);
const permissionList = (value: unknown, field: string): Permission[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${field} must be a list`);
  const unknown = value.filter((item) => !isPermission(item));
  if (unknown.length)
    throw new BadRequestException(`Unknown permission: ${unknown.join(', ')}`);
  return [...new Set(value as Permission[])];
};
const role = (value: unknown): RoleName => {
  if (!ROLES.includes(value as RoleName))
    throw new BadRequestException(`Role must be one of ${ROLES.join(', ')}`);
  return value as RoleName;
};
const normalisePhone = (value: unknown) => {
  const phone = text(value, 'Phone', 20).replace(/[\s()-]/g, '');
  if (!PHONE.test(phone))
    throw new BadRequestException(
      'Phone must be in international format, e.g. +260971234567',
    );
  return phone;
};

/** Staff accounts and field agents: the administrator's tools. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audits: AuditService,
    private readonly keycloak: KeycloakAdmin,
  ) {}

  // ---------- staff ----------

  catalog(actor: Access) {
    requirePermission(actor, 'staff.manage');
    return {
      permissions: ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })),
      roles: ROLES.map((key) => ({ key, defaults: ROLE_DEFAULTS[key] })),
      accountManagement: this.keycloak.configured,
    };
  }

  private toStaff(user: User & { team?: { name: string } | null }) {
    return {
      id: user.keycloakId,
      name: user.name,
      email: user.email,
      role: user.role,
      team: user.team?.name ?? null,
      active: user.active,
      availability: user.availability,
      capacity: user.capacity,
      grantedPermissions: user.grantedPermissions,
      revokedPermissions: user.revokedPermissions,
      permissions: effectivePermissions(user.role, user.grantedPermissions, user.revokedPermissions),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async listStaff(actor: Access) {
    requirePermission(actor, 'staff.manage');
    const users = await this.prisma.user.findMany({
      include: { team: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return users.map((user) => this.toStaff(user));
  }

  /** People who can still manage staff if `change` is applied to `keycloakId`. */
  private async managersAfter(keycloakId: string, change: Partial<User>) {
    const users = await this.prisma.user.findMany({ where: { active: true } });
    const others = users.filter((user) => user.keycloakId !== keycloakId);
    const current = users.find((user) => user.keycloakId === keycloakId);
    const after = current ? [...others, { ...current, ...change }] : others;
    return after.filter(
      (user) =>
        user.active &&
        effectivePermissions(user.role, user.grantedPermissions, user.revokedPermissions).includes('staff.manage'),
    ).length;
  }

  /** Creates the Keycloak account and the CaseDesk account together. */
  async createStaff(actor: Access, input: StaffInput) {
    requirePermission(actor, 'staff.manage');
    const name = text(input.name, 'Name');
    const email = text(input.email, 'Email', 254).toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('Email is not valid');
    const userRole = role(input.role);
    const granted = permissionList(input.grantedPermissions, 'grantedPermissions');
    const revoked = permissionList(input.revokedPermissions, 'revokedPermissions');
    if (await this.prisma.user.findUnique({ where: { email } }))
      throw new ConflictException('Someone with that email already has an account');

    const password = temporaryPassword();
    let keycloakId: string;
    try {
      keycloakId = await this.keycloak.createUser(keycloakName(name, email), password);
    } catch (error) {
      if (error instanceof KeycloakError && error.status === 409)
        throw new ConflictException('A sign-in account with that email already exists in Keycloak');
      throw error;
    }
    try {
      const team = await this.prisma.team.upsert({
        where: { name: DEFAULT_TEAM },
        update: {},
        create: { name: DEFAULT_TEAM, region: 'Zambia' },
      });
      const user = await this.prisma.user.create({
        data: {
          keycloakId,
          name,
          email,
          role: userRole,
          teamId: team.id,
          grantedPermissions: granted,
          revokedPermissions: revoked,
        },
        include: { team: true },
      });
      await this.audits.recordNow(null, actor.id, 'STAFF_ADDED', {
        staffId: keycloakId,
        email,
        role: userRole,
        grantedPermissions: granted,
        revokedPermissions: revoked,
      });
      return { staff: this.toStaff(user), temporaryPassword: password };
    } catch (error) {
      // Don't leave a Keycloak account with no CaseDesk account behind.
      await this.keycloak.deleteUser(keycloakId).catch(() => undefined);
      throw error;
    }
  }

  async updateStaff(actor: Access, keycloakId: string, input: StaffInput) {
    requirePermission(actor, 'staff.manage');
    const existing = await this.prisma.user.findUnique({ where: { keycloakId } });
    if (!existing) throw new NotFoundException('Staff member not found');

    const data: Partial<
      Pick<
        User,
        | 'name'
        | 'email'
        | 'role'
        | 'grantedPermissions'
        | 'revokedPermissions'
        | 'active'
        | 'availability'
        | 'capacity'
      >
    > = {};
    if (input.name !== undefined) data.name = text(input.name, 'Name');
    if (input.email !== undefined) {
      const email = text(input.email, 'Email', 254).toLowerCase();
      if (!EMAIL.test(email)) throw new BadRequestException('Email is not valid');
      if (email !== existing.email && (await this.prisma.user.findUnique({ where: { email } })))
        throw new ConflictException('Someone with that email already has an account');
      data.email = email;
    }
    if (input.role !== undefined) data.role = role(input.role);
    if (input.grantedPermissions !== undefined)
      data.grantedPermissions = permissionList(input.grantedPermissions, 'grantedPermissions');
    if (input.revokedPermissions !== undefined)
      data.revokedPermissions = permissionList(input.revokedPermissions, 'revokedPermissions');
    if (input.active !== undefined) data.active = Boolean(input.active);
    if (input.availability !== undefined) data.availability = Boolean(input.availability);
    if (input.capacity !== undefined) {
      const capacity = Number(input.capacity);
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 500)
        throw new BadRequestException('Capacity must be a whole number from 0 to 500');
      data.capacity = capacity;
    }

    // Never leave CaseDesk with nobody able to manage staff, and never let someone
    // lock themselves out by accident.
    const touchesAccess = ['role', 'grantedPermissions', 'revokedPermissions', 'active'].some((key) => key in data);
    if (touchesAccess) {
      const after = { ...existing, ...data } as User;
      const stillManager = after.active &&
        effectivePermissions(after.role, after.grantedPermissions, after.revokedPermissions).includes('staff.manage');
      if (keycloakId === actor.id && !stillManager)
        throw new BadRequestException(
          "You can't remove your own access to staff management or deactivate yourself. Ask another administrator.",
        );
      if ((await this.managersAfter(keycloakId, data as Partial<User>)) === 0)
        throw new BadRequestException('At least one active person must be able to manage staff');
    }

    // Keep Keycloak in step: name, email, and whether they can sign in at all.
    const keycloakChanges: Parameters<KeycloakAdmin['updateUser']>[1] = {};
    if (data.name || data.email)
      Object.assign(keycloakChanges, keycloakName((data.name as string) ?? existing.name, (data.email as string) ?? existing.email));
    if (data.active !== undefined && data.active !== existing.active) keycloakChanges.enabled = data.active as boolean;
    if (Object.keys(keycloakChanges).length) {
      await this.keycloak.updateUser(keycloakId, keycloakChanges);
      if (keycloakChanges.enabled === false) await this.keycloak.logout(keycloakId).catch(() => undefined);
    }

    const user = await this.prisma.user.update({ where: { keycloakId }, data, include: { team: true } });
    const changed = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, { from: existing[key as keyof User] ?? null, to: value }]),
    );
    const type =
      data.active === false && existing.active
        ? 'STAFF_DEACTIVATED'
        : data.active === true && !existing.active
          ? 'STAFF_REACTIVATED'
          : 'STAFF_UPDATED';
    await this.audits.recordNow(null, actor.id, type, { staffId: keycloakId, changed });
    const open =
      data.active === false
        ? await this.prisma.ticketAssignment.count({
            where: { active: true, userId: user.id, ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } } },
          })
        : 0;
    return { staff: this.toStaff(user), openTicketsToReassign: open };
  }

  async resetPassword(actor: Access, keycloakId: string) {
    requirePermission(actor, 'staff.manage');
    const existing = await this.prisma.user.findUnique({ where: { keycloakId } });
    if (!existing) throw new NotFoundException('Staff member not found');
    const password = temporaryPassword();
    await this.keycloak.resetPassword(keycloakId, password);
    await this.keycloak.logout(keycloakId).catch(() => undefined);
    await this.audits.recordNow(null, actor.id, 'STAFF_PASSWORD_RESET', { staffId: keycloakId });
    return { temporaryPassword: password };
  }

  // ---------- field agents ----------

  async listFieldAgents() {
    const agents = await this.prisma.fieldAgent.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
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

  async createFieldAgent(actor: Access, input: FieldAgentInput) {
    requirePermission(actor, 'field_agents.manage');
    const phone = normalisePhone(input.phone);
    if (await this.prisma.fieldAgent.findUnique({ where: { phone } }))
      throw new ConflictException('A field agent with that phone number already exists');
    const agent = await this.prisma.fieldAgent.create({
      data: {
        name: text(input.name, 'Name'),
        phone,
        employeeId: optionalText(input.employeeId, 40),
        region: optionalText(input.region),
        storeName: optionalText(input.storeName),
        shopType: optionalText(input.shopType, 60),
      },
    });
    await this.audits.recordNow(null, actor.id, 'FIELD_AGENT_ADDED', { fieldAgentId: agent.id, phone });
    return agent;
  }

  async updateFieldAgent(actor: Access, id: string, input: FieldAgentInput) {
    requirePermission(actor, 'field_agents.manage');
    const existing = await this.prisma.fieldAgent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Field agent not found');
    const data: Prisma.FieldAgentUpdateInput = {};
    if (input.name !== undefined) data.name = text(input.name, 'Name');
    if (input.phone !== undefined) {
      const phone = normalisePhone(input.phone);
      if (phone !== existing.phone) {
        if (await this.prisma.fieldAgent.findUnique({ where: { phone } }))
          throw new ConflictException('A field agent with that phone number already exists');
        // Past conversations are tied to the old number; changing it would orphan them.
        if (await this.prisma.whatsAppContact.findUnique({ where: { phone: existing.phone } }))
          throw new BadRequestException(
            'This agent already has WhatsApp conversations on their current number. Deactivate them and add the new number as a new agent.',
          );
        data.phone = phone;
      }
    }
    if (input.employeeId !== undefined) data.employeeId = optionalText(input.employeeId, 40);
    if (input.region !== undefined) data.region = optionalText(input.region);
    if (input.storeName !== undefined) data.storeName = optionalText(input.storeName);
    if (input.shopType !== undefined) data.shopType = optionalText(input.shopType, 60);
    if (input.active !== undefined) data.active = Boolean(input.active);
    const agent = await this.prisma.fieldAgent.update({ where: { id }, data });
    await this.audits.recordNow(null, actor.id, 'FIELD_AGENT_UPDATED', {
      fieldAgentId: id,
      fields: Object.keys(data),
    });
    return agent;
  }
}
