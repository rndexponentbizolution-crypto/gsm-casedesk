/**
 * Break-glass staff tools. Day-to-day account management happens in CaseDesk under
 * Staff; this is for setting up the first administrator and for recovery.
 *
 *   npm run staff -- list
 *   npm run staff -- bootstrap-admin --email you@example.com --name "Your Name"
 *   npm run staff -- deactivate --keycloak-id <id>
 *   npm run staff -- reactivate --keycloak-id <id>
 *
 * In the API container (no TypeScript tooling): node dist/cli/staff.js <command> ...
 *
 * bootstrap-admin creates the Keycloak sign-in and a CaseDesk ADMINISTRATOR (every
 * permission) and prints a one-time temporary password. It only works while nobody
 * can manage staff, so it cannot be used to add a second administrator behind the
 * existing one's back. Run it in your own terminal: the password is shown once.
 */
import { resolve } from 'node:path';
import { loadEnv } from '../load-env';
import { AuditService } from '../audit.service';
import {
  KeycloakAdmin,
  keycloakName,
  temporaryPassword,
} from '../keycloak-admin';
import { effectivePermissions } from '../permissions';
import { PrismaService } from '../prisma.service';

// src/cli and dist/cli are both two levels below apps/api.
loadEnv(resolve(__dirname, '..', '..'));

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

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  const prisma = new PrismaService();
  const audits = new AuditService(prisma);
  try {
    switch (command) {
      case 'list': {
        const users = await prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
        if (!users.length) console.log('No staff accounts yet. Run bootstrap-admin to create the first administrator.');
        else
          console.table(
            users.map((user) => ({
              keycloakId: user.keycloakId,
              name: user.name,
              email: user.email,
              role: user.role,
              active: user.active,
              permissions: effectivePermissions(user.role, user.grantedPermissions, user.revokedPermissions).length,
            })),
          );
        return;
      }
      case 'bootstrap-admin': {
        const email = need(flags, 'email').toLowerCase();
        const name = need(flags, 'name');
        const managers = (await prisma.user.findMany({ where: { active: true } })).filter((user) =>
          effectivePermissions(user.role, user.grantedPermissions, user.revokedPermissions).includes('staff.manage'),
        );
        if (managers.length)
          throw new Error(
            `An administrator already exists (${managers.map((user) => user.email).join(', ')}). Create accounts in CaseDesk under Staff instead.`,
          );
        if (await prisma.user.findUnique({ where: { email } }))
          throw new Error(`A CaseDesk account for ${email} already exists. Use reactivate, or pick another email.`);
        const keycloak = new KeycloakAdmin();
        if (await keycloak.findByEmail(email))
          throw new Error(`Keycloak already has a sign-in for ${email}. Remove it in the Keycloak admin console first, or pick another email.`);
        const password = temporaryPassword();
        const keycloakId = await keycloak.createUser(keycloakName(name, email), password);
        try {
          const team = await prisma.team.upsert({
            where: { name: DEFAULT_TEAM },
            update: {},
            create: { name: DEFAULT_TEAM, region: 'Zambia' },
          });
          await prisma.user.create({
            data: { keycloakId, name, email, role: 'ADMINISTRATOR', teamId: team.id },
          });
        } catch (error) {
          await keycloak.deleteUser(keycloakId).catch(() => undefined);
          throw error;
        }
        await audits.recordNow(null, 'system', 'STAFF_ADDED', {
          staffId: keycloakId,
          email,
          role: 'ADMINISTRATOR',
          via: 'bootstrap-admin',
        });
        console.log(`\nCreated administrator ${name} <${email}>.`);
        console.log(`\n  Sign-in:            ${email}`);
        console.log(`  Temporary password: ${password}\n`);
        console.log('You will be asked to choose your own password and set up an authenticator app at first sign-in.');
        console.log('This temporary password is not stored anywhere and will not be shown again.\n');
        return;
      }
      case 'deactivate':
      case 'reactivate': {
        const keycloakId = need(flags, 'keycloak-id');
        const existing = await prisma.user.findUnique({ where: { keycloakId } });
        if (!existing) throw new Error(`No CaseDesk user with keycloak id ${keycloakId}`);
        const active = command === 'reactivate';
        await prisma.user.update({ where: { keycloakId }, data: { active } });
        const keycloak = new KeycloakAdmin();
        if (keycloak.configured) {
          await keycloak.updateUser(keycloakId, { enabled: active });
          if (!active) await keycloak.logout(keycloakId).catch(() => undefined);
        }
        await audits.recordNow(null, 'system', active ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED', {
          staffId: keycloakId,
          via: 'cli',
        });
        console.log(`${existing.name} is now ${active ? 'active' : 'deactivated'}.`);
        return;
      }
      default:
        throw new Error('Usage: npm run staff -- list | bootstrap-admin | deactivate | reactivate (see src/cli/staff.ts)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
