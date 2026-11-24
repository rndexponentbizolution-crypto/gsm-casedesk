import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { effectivePermissions, type Permission, type RoleName } from './permissions';
import { PrismaService } from './prisma.service';

/**
 * Authentication: Keycloak proves who the caller is (a signed OIDC access token).
 * Authorisation: the CaseDesk `User` row decides what they may do — its role, its
 * per-person permission grants and revokes, and its active flag. A valid token for
 * someone with no active CaseDesk account is refused. There is no other way in.
 */

export type Actor = {
  /** The user's Keycloak subject (`sub`), stored as `User.keycloakId`. */
  id: string;
  role: RoleName;
  name: string;
  email: string;
  /** Effective permissions: role defaults plus grants, minus revokes. */
  permissions: Permission[];
};

const IS_PUBLIC = 'casedesk:public';
/** Marks a route as reachable without signing in (health checks only). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>;
  actor?: Actor;
};

/** The signed-in caller, as resolved by {@link AuthGuard}. */
export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor => {
    const actor = ctx.switchToHttp().getRequest<AuthedRequest>().actor;
    if (!actor) throw new UnauthorizedException('Sign in required');
    return actor;
  },
);

/** Verifies a Keycloak access token and returns its subject. */
@Injectable()
export class TokenVerifier {
  private jwks?: ReturnType<typeof import('jose').createRemoteJWKSet>;

  private config() {
    const base = (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(
      /\/+$/,
      '',
    );
    const realm = process.env.KEYCLOAK_REALM ?? 'gsm-casedesk';
    return {
      // The issuer is the URL browsers use; it can differ from the URL the API
      // reaches Keycloak on (e.g. http://keycloak:8080 inside Docker).
      issuer:
        process.env.KEYCLOAK_ISSUER?.replace(/\/+$/, '') ??
        `${base}/realms/${realm}`,
      jwksUrl: `${base}/realms/${realm}/protocol/openid-connect/certs`,
      audience: process.env.KEYCLOAK_AUDIENCE ?? 'gsm-casedesk-api',
    };
  }

  async verify(token: string): Promise<string> {
    // jose is ESM-only; load it lazily so CommonJS tooling never has to.
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const { issuer, jwksUrl, audience } = this.config();
    this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer,
      audience,
      algorithms: ['RS256', 'PS256', 'ES256'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub)
      throw new Error('Token has no subject');
    return payload.sub;
  }
}

const header = (req: AuthedRequest, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Global, deny-by-default guard: every route needs a signed-in, active user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const subject = await this.subject(req);
    const user = await this.prisma.user.findUnique({
      where: { keycloakId: subject },
      select: {
        keycloakId: true,
        role: true,
        name: true,
        email: true,
        active: true,
        grantedPermissions: true,
        revokedPermissions: true,
      },
    });
    if (!user || !user.active)
      throw new ForbiddenException(
        'Your sign-in worked, but you do not have an active CaseDesk account. Ask an administrator to add you.',
      );
    req.actor = {
      id: user.keycloakId,
      role: user.role,
      name: user.name,
      email: user.email,
      permissions: effectivePermissions(
        user.role,
        user.grantedPermissions,
        user.revokedPermissions,
      ),
    };
    return true;
  }

  private async subject(req: AuthedRequest): Promise<string> {
    const match = /^Bearer\s+(\S+)$/i.exec(header(req, 'authorization') ?? '');
    if (!match) throw new UnauthorizedException('Sign in required');
    try {
      return await this.tokens.verify(match[1]);
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }
  }
}
