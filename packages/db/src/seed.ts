import { z } from 'zod';
import { createDatabase } from './client.js';
import { seedAdmin, seedDemoWorkspaces, seedRoles } from './seed-lib.js';

const seedEnv = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required to run the seed'),
  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
});

/**
 * Idempotent CLI seed. Safe to run repeatedly. Never logs secrets.
 * Deliberately does NOT load the full application config — seeding must not
 * require unrelated app secrets.
 *  1. Built-in role catalog + permission matrix
 *  2. Bootstrap admin (only when SEED_ADMIN_EMAIL/PASSWORD are set)
 *  3. Demo workspaces (home-demo, office-demo)
 */
async function main() {
  const parsed = seedEnv.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      '[seed] invalid environment:',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
    process.exit(1);
  }
  const { DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = parsed.data;
  const db = createDatabase(DATABASE_URL, { max: 1 });
  try {
    await seedRoles(db);
    console.warn('[seed] role catalog ensured');

    if (SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD) {
      const admin = await seedAdmin(db, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
      console.warn(`[seed] bootstrap admin ${admin.created ? 'created' : 'already exists'}`);
      await seedDemoWorkspaces(db, admin.id);
      console.warn('[seed] demo workspaces ensured (home-demo, office-demo)');
    } else {
      console.warn('[seed] SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set; skipping admin and demo data');
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
