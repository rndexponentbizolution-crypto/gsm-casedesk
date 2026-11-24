import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Reference data only. There are no sample staff, field agents or tickets: the
 * first administrator is created with `npm run staff -- bootstrap-admin`, and
 * everyone and everything else is added in CaseDesk.
 */
async function main() {
  await prisma.team.upsert({
    where: { name: 'Zambia Field Support' },
    update: {},
    create: { name: 'Zambia Field Support', region: 'Zambia' },
  });
  const staff = await prisma.user.count();
  console.log(
    staff
      ? 'Reference data is ready.'
      : 'Reference data is ready. No staff yet: run `npm run staff -- bootstrap-admin --email <you> --name "<Your Name>"`.',
  );
}

main().finally(() => prisma.$disconnect());
