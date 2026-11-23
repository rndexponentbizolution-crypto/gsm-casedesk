import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, TokenVerifier, authMode } from './auth';
import { PrismaService } from './prisma.service';

type User = {
  keycloakId: string;
  role: 'BACK_OFFICE' | 'SUPERVISOR' | 'ADMINISTRATOR';
  name: string;
  active: boolean;
};

const USERS: User[] = [
  {
    keycloakId: 'demo-agent-1',
    role: 'BACK_OFFICE',
    name: 'Martha Banda',
    active: true,
  },
  {
    keycloakId: 'retired',
    role: 'SUPERVISOR',
    name: 'Former Staff',
    active: false,
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

function guard(env: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return new AuthGuard(reflector, prisma, tokens);
  } finally {
    process.env = saved;
  }
}

describe('authMode', () => {
  it('defaults to keycloak', () => {
    expect(authMode({})).toBe('keycloak');
  });
  it('refuses demo mode in production', () => {
    expect(() =>
      authMode({ AUTH_MODE: 'demo', NODE_ENV: 'production' }),
    ).toThrow(/not allowed/);
  });
  it('rejects unknown modes', () => {
    expect(() => authMode({ AUTH_MODE: 'none' })).toThrow(/Unknown/);
  });
});

describe('AuthGuard (keycloak mode)', () => {
  const g = guard({ AUTH_MODE: 'keycloak', NODE_ENV: 'test' });

  it('lets public routes through without a token', async () => {
    await expect(g.canActivate(contextFor({}, true).ctx)).resolves.toBe(true);
  });

  it('rejects a request with no token', async () => {
    await expect(g.canActivate(contextFor({}).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ignores demo headers', async () => {
    const { ctx } = contextFor({
      'x-demo-user': 'demo-agent-1',
      'x-demo-role': 'SUPERVISOR',
    });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
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

  it('takes the role from the CaseDesk account, not the request', async () => {
    const { ctx, req } = contextFor({
      authorization: 'Bearer valid:demo-agent-1',
      'x-demo-role': 'SUPERVISOR',
    });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(req.actor).toEqual({
      id: 'demo-agent-1',
      role: 'BACK_OFFICE',
      name: 'Martha Banda',
    });
  });
});

describe('AuthGuard (demo mode)', () => {
  const g = guard({ AUTH_MODE: 'demo', NODE_ENV: 'development' });

  it('has no default identity', async () => {
    await expect(g.canActivate(contextFor({}).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('cannot escalate privileges with x-demo-role', async () => {
    const { ctx, req } = contextFor({
      'x-demo-user': 'demo-agent-1',
      'x-demo-role': 'ADMINISTRATOR',
    });
    await g.canActivate(ctx);
    expect((req.actor as { role: string }).role).toBe('BACK_OFFICE');
  });
});
