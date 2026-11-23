/**
 * Re-computes the audit log's hash chain and reports the first broken event.
 * Exit code 0 = intact, 1 = broken (suitable for a scheduled job or alert).
 *
 *   npm run audit:verify
 */
import { resolve } from 'node:path';
import { loadEnv } from '../load-env';
import { AuditService } from '../audit.service';
import { PrismaService } from '../prisma.service';

// src/cli and dist/cli are both two levels below apps/api.
loadEnv(resolve(__dirname, '..', '..'));

async function main() {
  const prisma = new PrismaService();
  try {
    const result = await new AuditService(prisma).verify();
    if (result.brokenAt) {
      console.error(
        `Audit chain BROKEN at event ${result.brokenAt} after ${result.checked} good events: ${result.reason}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Audit chain intact: ${result.checked} events` +
        (result.linkOnly
          ? ` (${result.linkOnly} older events predate content hashing; only their links were checked)`
          : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
