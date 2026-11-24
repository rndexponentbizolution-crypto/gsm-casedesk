import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, TokenVerifier } from './auth';
import { effectivePermissions, ROLE_DEFAULTS } from './permissions';
import { PrismaService } from './prisma.service';

type User = {
  keycloakId: string;
  role: 'BACK_OFFICE' | 'SUPERVISOR' | 'ADMINISTRATOR';
  name: string;
  email: string;
  active: boolean;
  grantedPermissions: string[];
  revokedPermissions: string[];
};

const USERS: User[] = [
  {
    keycloakId: 'agent',
    role: 'BACK_OFFICE',
    name: 'Back Office',
    email: 'agent@example.test',
    active: true,
    grantedPermissions: ['reports.view'],
    revokedPermissions: [],
  },
  {
    keycloakId: 'restricted-supervisor',
    role: 'SUPERVISOR',
    name: 'Restricted Supervisor',
    email: 'sup@example.test',
    active: true,
    grantedPermissions: [],
    revokedPermissions: ['reports.export', 'tickets.reassign'],
  },
  {
    keycloakId: 'retired',
    role: 'SUPERVISOR',
    name: 'Former Staff',
    email: 'former@example.test',
    active: false,
    grantedPermissions: [],
    revokedPermissions: [],
  },
];

const prisma = {
  user: {
    findUnique: ({ where }: { where: { keycloakId: string } }) =>
      Promise.resolve(
        USERS.find((user) => user.keycloakId === where.keycloakId) ?? null,
      ),
  },
} as unknown as PrismaService;

const tokens = {
  verify: (token: string) =>
    token.startsWith('valid:')
      ? Promise.resolve(token.slice('valid:'.length))
      : Promise.reject(new Error('bad signature')),
} as unknown as TokenVerifier;

function contextFor(
  headers: Record<string, string>,
  isPublic = false,
): {
  ctx: ExecutionContext;
  req: { headers: typeof headers; actor?: unknown };
} {
  const req: { headers: typeof headers; actor?: unknown } = { headers };
  const ctx = {
    getHandler: () => (isPublic ? 'public' : 'private'),
    getClass: () => 'controller',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const reflector = {
  getAllAndOverride: (_: string, [handler]: string[]) => handler === 'public',
} as unknown as Reflector;

describe('effectivePermissions', () => {
  it('starts from the role and applies per-person grants and revokes', () => {
    expect(effectivePermissions('BACK_OFFICE')).toEqual(['tickets.reply']);
    expect(effectivePermissions('BACK_OFFICE', ['reports.view'])).toEqual([
      'tickets.reply',
      'reports.view',
    ]);
    expect(
      effectivePermissions('SUPERVISOR', [], ['reports.export']),
    ).not.toContain('reports.export');
  });
  it('gives administrators everything, including staff management', () => {
    expect(effectivePermissions('ADMINISTRATOR')).toContain('staff.manage');
    expect(ROLE_DEFAULTS.SUPERVISOR).not.toContain('staff.manage');
  });
  it('ignores unknown permission names', () => {
    expect(effectivePermissions('BACK_OFFICE', ['root', 'staff.manage!'])).toEqual(['tickets.reply']);
  });
});

describe('AuthGuard', () => {
  const g = new AuthGuard(reflector, prisma, tokens);

  it('lets public routes through without a token', async () => {
    await expect(g.canActivate(contextFor({}, true).ctx)).resolves.toBe(true);
  });

  it('rejects a request with no token', async () => {
    await expect(g.canActivate(contextFor({}).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ignores the old demo headers, whatever AUTH_MODE says', async () => {
    const saved = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'demo';
    try {
      const { ctx } = contextFor({
        'x-demo-user': 'agent',
        'x-demo-role': 'ADMINISTRATOR',
      });
      await expect(new AuthGuard(reflector, prisma, tokens).canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.AUTH_MODE = saved;
    }
  });

  it('rejects an invalid token', async () => {
    const { ctx } = contextFor({ authorization: 'Bearer forged' });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses valid tokens for unknown or inactive users', async () => {
    for (const sub of ['stranger', 'retired']) {
      const { ctx } = contextFor({ authorization: `Bearer valid:${sub}` });
      await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('takes role and permissions from the CaseDesk account, not the request', async () => {
    const { ctx, req } = contextFor({
      authorization: 'Bearer valid:agent',
      'x-demo-role': 'SUPERVISOR',
    });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(req.actor).toEqual({
      id: 'agent',
      role: 'BACK_OFFICE',
      name: 'Back Office',
      email: 'agent@example.test',
      permissions: ['tickets.reply', 'reports.view'],
    });
  });

  it('applies revoked permissions', async () => {
    const { ctx, req } = contextFor({ authorization: 'Bearer valid:restricted-supervisor' });
    await g.canActivate(ctx);
    const permissions = (req.actor as { permissions: string[] }).permissions;
    expect(permissions).toContain('reports.view');
    expect(permissions).not.toContain('reports.export');
    expect(permissions).not.toContain('tickets.reassign');
  });
});
