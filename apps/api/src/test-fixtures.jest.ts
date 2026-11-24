/**
 * Test-only staff and field agents, created in the *_test database by the database
 * suites (never by the seed). Ids and numbers are obviously fake.
 */
import { PrismaService } from './prisma.service';
import { effectivePermissions, type RoleName } from './permissions';
import type { Actor } from './auth';
import { SAFE_HOSTS } from './test-db.jest';

/** Throws unless DATABASE_URL is the local/CI *_test database set up by globalSetup. */
export function assertTestDatabase() {
  let url: URL | null = null;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    /* not set */
  }
  const name = url?.pathname.replace(/^\//, '') ?? '';
  if (!url || !SAFE_HOSTS.includes(url.hostname) || !name.endsWith('_test'))
    throw new Error(
      `Refusing to run database tests against "${url ? `${url.hostname}/${name}` : '(DATABASE_URL not set)'}". They need the *_test database prepared by the Jest global setup.`,
    );
}

const actor = (id: string, role: RoleName, name: string): Actor => ({
  id,
  role,
  name,
  email: `${id}@example.test`,
  permissions: effectivePermissions(role),
});

export const SUP = actor('test-supervisor', 'SUPERVISOR', 'Test Supervisor');
export const AGENT_1 = actor('test-agent-1', 'BACK_OFFICE', 'Test Agent One');
export const AGENT_2 = actor('test-agent-2', 'BACK_OFFICE', 'Test Agent Two');
export const ADMIN = actor('test-admin', 'ADMINISTRATOR', 'Test Admin');
export const JOSEPH = '+260970000001';
export const RUTH = '+260970000002';

/** Creates the fixture team, staff and field agents if they are missing. */
export async function seedFixtures(prisma: PrismaService) {
  const team = await prisma.team.upsert({
    where: { name: 'Zambia Field Support' },
    update: {},
    create: { name: 'Zambia Field Support', region: 'Zambia' },
  });
  for (const person of [SUP, AGENT_1, AGENT_2, ADMIN])
    await prisma.user.upsert({
      where: { keycloakId: person.id },
      update: { active: true, availability: true, role: person.role, grantedPermissions: [], revokedPermissions: [] },
      create: { keycloakId: person.id, name: person.name, email: person.email, role: person.role, teamId: team.id },
    });
  const agents = [
    { name: 'Test Field Agent One', phone: JOSEPH, employeeId: 'T-001', region: 'Lusaka', storeName: 'Test Store', shopType: 'Connect Store' },
    { name: 'Test Field Agent Two', phone: RUTH, employeeId: 'T-002', region: 'Copperbelt', storeName: 'Test Container', shopType: 'Container' },
  ];
  for (const agent of agents)
    await prisma.fieldAgent.upsert({ where: { phone: agent.phone }, update: { active: true }, create: agent });
}
