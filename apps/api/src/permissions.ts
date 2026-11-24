import { ForbiddenException } from '@nestjs/common';

/**
 * What a staff member may do. A role supplies defaults; each person can then be
 * granted extra permissions or have defaults revoked. Effective permissions are
 * (role defaults ∪ granted) − revoked.
 */
export const PERMISSIONS = {
  'tickets.reply':
    'Reply, send files, update casework and change the status of tickets they can see',
  'tickets.view_all': 'See every ticket, not only those assigned to them',
  'tickets.reassign': 'Reassign tickets to other staff',
  'reports.view': 'View desk-wide reports',
  'reports.export': 'Export reports and the daily log',
  'operations.manage': 'See and retry failed or stuck WhatsApp messages',
  'field_agents.manage': 'Add, edit and deactivate field agents',
  'audit.verify': 'Check the audit trail for tampering',
  'staff.manage':
    'Create staff accounts, reset passwords, and change roles and permissions',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleName = 'BACK_OFFICE' | 'SUPERVISOR' | 'ADMINISTRATOR';

export const ROLE_DEFAULTS: Record<RoleName, Permission[]> = {
  BACK_OFFICE: ['tickets.reply'],
  SUPERVISOR: [
    'tickets.reply',
    'tickets.view_all',
    'tickets.reassign',
    'reports.view',
    'reports.export',
    'operations.manage',
    'audit.verify',
  ],
  ADMINISTRATOR: [...ALL_PERMISSIONS],
};

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && value in PERMISSIONS;

export function effectivePermissions(
  role: RoleName,
  granted: readonly string[] = [],
  revoked: readonly string[] = [],
): Permission[] {
  const set = new Set<Permission>([
    ...ROLE_DEFAULTS[role],
    ...granted.filter(isPermission),
  ]);
  for (const permission of revoked) set.delete(permission as Permission);
  return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

/** The caller, as the API sees them. */
export interface Access {
  id: string;
  permissions: readonly string[];
}

export const can = (actor: Access, permission: Permission) =>
  actor.permissions.includes(permission);

export function requirePermission(actor: Access, permission: Permission) {
  if (!can(actor, permission))
    throw new ForbiddenException(
      `You don't have permission to do this (${permission}). Ask an administrator.`,
    );
}
