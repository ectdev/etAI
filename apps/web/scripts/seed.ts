import { closeDb } from '@etai/db';
import { auth, type Role } from '../lib/auth';

/**
 * Creates the two demo accounts the README hands out.
 *
 * This lives beside the auth configuration rather than in the database package
 * because the password hash has to be produced by the same instance that will later
 * verify it. Reimplementing the hashing next to the schema would work right up until
 * one of the two settings changed.
 *
 * Sign-up is closed in this application, so accounts are created through the
 * library's internal adapter instead of through the public endpoint.
 */
const DEMO_ACCOUNTS: Array<{ email: string; name: string; password: string; role: Role }> = [
  {
    email: 'admin@etai.local',
    name: 'Demo Administrator',
    password: 'demo-admin-password',
    role: 'admin',
  },
  {
    email: 'user@etai.local',
    name: 'Demo User',
    password: 'demo-user-password',
    role: 'user',
  },
];

async function seed() {
  const ctx = await auth.$context;

  for (const account of DEMO_ACCOUNTS) {
    const existing = await ctx.internalAdapter.findUserByEmail(account.email);

    if (existing?.user) {
      // Running the seed twice should not create a second copy or change a password
      // that someone is in the middle of using.
      console.log(`already present : ${account.email}`);
      continue;
    }

    const user = await ctx.internalAdapter.createUser({
      email: account.email,
      name: account.name,
      // There is no mail server here, so requiring verification would lock the demo
      // accounts out of their own application.
      emailVerified: true,
      role: account.role,
    });

    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(account.password),
    });

    console.log(`created         : ${account.email} (${account.role})`);
  }

  console.log('\nSign in with either account at /sign-in. Both passwords are in the README.');
}

try {
  await seed();
} catch (error) {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
