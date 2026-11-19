import { PrismaClient, RoleName } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const team = await prisma.team.upsert({
    where: { name: 'Zambia Field Support' },
    update: {},
    create: { name: 'Zambia Field Support', region: 'Zambia' },
  });

  await prisma.user.upsert({
    where: { email: 'agent1@gsm.local' },
    update: {},
    create: {
      keycloakId: 'demo-agent-1',
      name: 'Martha Banda',
      email: 'agent1@gsm.local',
      role: RoleName.BACK_OFFICE,
      teamId: team.id,
      capacity: 20,
    },
  });
  await prisma.user.upsert({
    where: { email: 'supervisor@gsm.local' },
    update: {},
    create: {
      keycloakId: 'demo-supervisor',
      name: 'Chanda Mwansa',
      email: 'supervisor@gsm.local',
      role: RoleName.SUPERVISOR,
      teamId: team.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'agent2@gsm.local' },
    update: {},
    create: {
      keycloakId: 'demo-agent-2',
      name: 'Peter Mulenga',
      email: 'agent2@gsm.local',
      role: RoleName.BACK_OFFICE,
      teamId: team.id,
      capacity: 20,
    },
  });

  await prisma.fieldAgent.upsert({
    where: { phone: '+260970000001' },
    update: {},
    create: { name: 'Joseph Tembo', phone: '+260970000001', employeeId: 'FA-001', region: 'Lusaka', teamId: team.id },
  });
  await prisma.fieldAgent.upsert({
    where: { phone: '+260970000002' },
    update: {},
    create: { name: 'Ruth Phiri', phone: '+260970000002', employeeId: 'FA-002', region: 'Copperbelt', teamId: team.id },
  });

  console.log('Synthetic GSM CaseDesk seed data is ready');
}

main().finally(() => prisma.$disconnect());
