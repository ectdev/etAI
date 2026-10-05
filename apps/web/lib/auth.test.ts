import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { auth, isRole } from './auth';

/**
 * Exercises sign-in against the real database.
 *
 * The schema for the auth tables was written by hand rather than generated, so the
 * check that matters is not whether the columns look right. It is whether a user can
 * be created, sign in, and arrive with a role attached. Comparing column names was
 * tried first and proved worthless, because the library names its fields in camelCase
 * and the adapter maps them onto snake_case columns.
 *
 * Requires the database to be running: docker compose up -d && pnpm db:migrate
 */
const TEST_USERS = [
  {
    email: 'test-admin@etai.test',
    name: 'Test Admin',
    password: 'test-password-1234',
    role: 'admin',
  },
  { email: 'test-user@etai.test', name: 'Test User', password: 'test-password-5678', role: 'user' },
] as const;

async function removeTestUsers() {
  const ctx = await auth.$context;

  for (const user of TEST_USERS) {
    const found = await ctx.internalAdapter.findUserByEmail(user.email);
    if (found?.user) {
      await ctx.internalAdapter.deleteUser(found.user.id);
    }
  }
}

beforeAll(async () => {
  const ctx = await auth.$context;
  await removeTestUsers();

  for (const user of TEST_USERS) {
    const created = await ctx.internalAdapter.createUser({
      email: user.email,
      name: user.name,
      emailVerified: true,
      role: user.role,
    });

    await ctx.internalAdapter.createAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: await ctx.password.hash(user.password),
    });
  }
});

afterAll(async () => {
  await removeTestUsers();
  await closeDb();
});

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password }, asResponse: true });
}

async function sessionFrom(response: Response) {
  const cookie = response.headers.get('set-cookie');
  if (!cookie) return null;

  return auth.api.getSession({
    headers: new Headers({ cookie: cookie.split(';')[0] ?? '' }),
  });
}

describe('signing in', () => {
  it('accepts the right password and returns a session cookie', async () => {
    const response = await signIn(TEST_USERS[0].email, TEST_USERS[0].password);

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeTruthy();
  });

  it('carries the role in the session, which is what authorisation reads', async () => {
    for (const user of TEST_USERS) {
      const session = await sessionFrom(await signIn(user.email, user.password));

      expect(session?.user.email).toBe(user.email);
      expect(session?.user.role).toBe(user.role);
    }
  });

  it('rejects a wrong password', async () => {
    const response = await signIn(TEST_USERS[0].email, 'not-the-password');
    expect(response.status).toBe(401);
  });

  it('rejects an email that has no account, with the same status as a wrong password', async () => {
    // Answering differently would turn the form into a way to discover which
    // addresses have accounts.
    const missing = await signIn('nobody@etai.test', 'test-password-1234');
    const wrongPassword = await signIn(TEST_USERS[0].email, 'not-the-password');

    expect(missing.status).toBe(wrongPassword.status);
  });

  it('gives no session for an empty password', async () => {
    const response = await signIn(TEST_USERS[0].email, '');
    expect(response.status).not.toBe(200);
  });

  it('does not treat the email as case sensitive but does treat the password as such', async () => {
    const upperEmail = await signIn(TEST_USERS[0].email.toUpperCase(), TEST_USERS[0].password);
    const upperPassword = await signIn(TEST_USERS[0].email, TEST_USERS[0].password.toUpperCase());

    expect(upperEmail.status).toBe(200);
    expect(upperPassword.status).toBe(401);
  });
});

describe('reading a session', () => {
  it('returns nothing when there is no cookie at all', async () => {
    const session = await auth.api.getSession({ headers: new Headers() });
    expect(session).toBeNull();
  });

  it('returns nothing for a cookie that was made up', async () => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: 'better-auth.session_token=forged-value' }),
    });

    expect(session).toBeNull();
  });
});

describe('isRole', () => {
  it('accepts the roles the application checks against', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('user')).toBe(true);
  });

  it.each(['superuser', 'Admin', '', null, undefined, 7, {}])(
    'rejects %o, because the column is text and could hold it',
    (value) => {
      expect(isRole(value)).toBe(false);
    },
  );
});
