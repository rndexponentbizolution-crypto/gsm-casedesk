/**
 * Staff onboarding for CaseDesk. Keycloak proves who someone is; this creates the
 * CaseDesk account that decides what they may do. Every change is audited.
 *
 * In the API container (no TypeScript tooling) use: node dist/cli/staff.js <command> ...
 *
 *   npm run staff -- list
 *   npm run staff -- add --keycloak-id <uuid> --name "Jane Phiri" --email jane@example.com
 *                        --role BACK_OFFICE|SUPERVISOR|ADMINISTRATOR [--team "Zambia Field Support"]
 *                        [--by <your keycloak id>]
 *   npm run staff -- set-role   --keycloak-id <uuid> --role SUPERVISOR [--by <id>]
 *   npm run staff -- deactivate --keycloak-id <uuid> [--by <id>]
 *   npm run staff -- reactivate --keycloak-id <uuid> [--by <id>]
 *
 * The Keycloak ID is the user's "ID" in the Keycloak admin console (Users -> user).
 * Deactivating takes effect on their next request; their open tickets stay assigned
 * until a supervisor reassigns them.
 */
import { RoleName } from '@prisma/client';
import { resolve } from 'node:path';
import { loadEnv } from '../load-env';
import { AuditService } from '../audit.service';
import { PrismaService } from '../prisma.service';

// src/cli and dist/cli are both two levels below apps/api.
loadEnv(resolve(__dirname, '..', '..'));

const ROLES = Object.values(RoleName);
const DEFAULT_TEAM = 'Zambia Field Support';

function parse(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([\w-]+)$/.exec(rest[i]);
    if (!match) throw new Error(`Unexpected argument: ${rest[i]}`);
    flags[match[1]] = rest[++i] ?? '';
  }
  return { command, flags };
}

const need = (flags: Record<string, string>, name: string) => {
  const value = flags[name]?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

const role = (value: string) => {
  const upper = value.toUpperCase() as RoleName;
  if (!ROLES.includes(upper))
    throw new Error(`--role must be one of ${ROLES.join(', ')}`);
  return upper;
};

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  const prisma = new PrismaService();
  const audits = new AuditService(prisma);
  // Who made the change: a staff keycloak id, or "system" for scripted setup.
  const by = flags.by?.trim() || 'system';
  const change = async (type: string, metadata: Record<string, unknown>) =>
    audits.recordNow(null, by, type, metadata);

  try {
    switch (command) {
      case 'list': {
        const users = await prisma.user.findMany({
          include: { team: true },
          orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
        });
        console.table(
          users.map((user) => ({
            keycloakId: user.keycloakId,
            name: user.name,
            email: user.email,
            role: user.role,
            team: user.team?.name ?? '',
            active: user.active,
          })),
        );
        return;
      }
      case 'add': {
        const keycloakId = need(flags, 'keycloak-id');
        const teamName = flags.team?.trim() || DEFAULT_TEAM;
        const team = await prisma.team.upsert({
          where: { name: teamName },
          update: {},
          create: { name: teamName },
        });
        const user = await prisma.user.create({
          data: {
            keycloakId,
            name: need(flags, 'name'),
            email: need(flags, 'email').toLowerCase(),
            role: role(need(flags, 'role')),
            teamId: team.id,
          },
        });
        await change('STAFF_ADDED', {
          keycloakId,
          role: user.role,
          team: teamName,
        });
        console.log(`Added ${user.name} (${user.role}).`);
        return;
      }
      case 'set-role':
      case 'deactivate':
      case 'reactivate': {
        const keycloakId = need(flags, 'keycloak-id');
        const existing = await prisma.user.findUnique({ where: { keycloakId } });
        if (!existing) throw new Error(`No CaseDesk user with keycloak id ${keycloakId}`);
        if (command === 'set-role') {
          const next = role(need(flags, 'role'));
          await prisma.user.update({ where: { keycloakId }, data: { role: next } });
          await change('STAFF_ROLE_CHANGED', { keycloakId, from: existing.role, to: next });
          console.log(`${existing.name}: ${existing.role} -> ${next}`);
        } else {
          const active = command === 'reactivate';
          await prisma.user.update({ where: { keycloakId }, data: { active } });
          await change(active ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED', { keycloakId });
          const open = await prisma.ticketAssignment.count({
            where: {
              active: true,
              user: { keycloakId },
              ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
            },
          });
          console.log(
            `${existing.name} is now ${active ? 'active' : 'deactivated'}.` +
              (!active && open ? ` They still hold ${open} open ticket(s); reassign them.` : ''),
          );
        }
        return;
      }
      default:
        throw new Error(
          'Usage: npm run staff -- list | add | set-role | deactivate | reactivate (see src/cli/staff.ts)',
        );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
