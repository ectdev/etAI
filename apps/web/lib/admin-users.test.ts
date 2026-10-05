import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { auth } from './auth';
import { createUser } from './admin-users';

/**
 * Creating an account, and who may do it.
 *
 * This is the only place in the application where a role is chosen rather than read, so a
 * missing check here does not leak data: it hands somebody the admin role. That is what
 * most of this file is about.
 *
 * The other half is that the account actually works. A user row with a password stored
 * the wrong way looks correct in the database and cannot sign in, and nothing would say
 * so until a person tried, so every creation here is followed by a sign-in.
 *
 * Requires the database: docker compose up -d && pnpm db:migrate
 */

const ADMIN = {
  email: 'creator-admin@etai.test',
  name: 'Creator',
  password: 'admin-password-1234',
};
const PLAIN = { email: 'creator-user@etai.test', name: 'Plain', password: 'user-password-1234' };
const MADE = 'made-by-admin@etai.test';

const input = (overrides: Partial<Parameters<typeof createUser>[1]> = {}) => ({
  email: MADE,
  name: 'Made By Admin',
  password: 'a-created-password',
  role: 'user' as const,
  ...overrides,
});

async function remove(email: string) {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  if (found?.user) await ctx.internalAdapter.deleteUser(found.user.id);
}

async function makeAccount(account: typeof ADMIN, role: 'admin' | 'user') {
  const ctx = await auth.$context;
  await remove(account.email);

  const created = await ctx.internalAdapter.createUser({
    email: account.email,
    name: account.name,
    emailVerified: true,
    role,
  });

  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(account.password),
  });
}

/** Signs in and returns the cookie header, or null when the credentials are refused. */
async function signIn(email: string, password: string): Promise<string | null> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!response.ok) return null;

  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

const asHeaders = (cookie: string | null) => new Headers(cookie ? { cookie } : {});

const status = (error: unknown) => (error as { status?: number }).status ?? 500;

beforeEach(async () => {
  await makeAccount(ADMIN, 'admin');
  await makeAccount(PLAIN, 'user');
  await remove(MADE);
});

afterEach(async () => {
  await remove(MADE);
});

afterAll(async () => {
  for (const email of [ADMIN.email, PLAIN.email, MADE]) await remove(email);
  await closeDb();
});

describe('who may create an account', () => {
  it('refuses a regular user', async () => {
    const headers = asHeaders(await signIn(PLAIN.email, PLAIN.password));

    await expect(createUser(headers, input())).rejects.toSatisfy(
      (error) => status(error) === 403,
      'a regular user was allowed to create an account',
    );

    // Nothing was written. Without this, an endpoint that created the row and then threw
    // would pass the assertion above.
    const ctx = await auth.$context;
    expect((await ctx.internalAdapter.findUserByEmail(MADE))?.user).toBeFalsy();
  });

  it('refuses a signed-out request', async () => {
    await expect(createUser(new Headers(), input())).rejects.toSatisfy(
      (error) => status(error) === 401,
    );
  });

  it('refuses a regular user trying to create an administrator', async () => {
    // The escalation this check exists to stop, stated as its own case so that removing
    // the role check fails on the thing that actually matters.
    const headers = asHeaders(await signIn(PLAIN.email, PLAIN.password));

    await expect(createUser(headers, input({ role: 'admin' }))).rejects.toSatisfy(
      (error) => status(error) === 403,
    );
  });

  it('allows an administrator', async () => {
    // The premise. If createUser rejected everybody, every assertion above would pass.
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    const created = await createUser(headers, input());

    expect(created.email).toBe(MADE);
    expect(created.role).toBe('user');
  });
});

describe('the account that comes out', () => {
  it('can sign in with the password it was given', async () => {
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    await createUser(headers, input());

    expect(
      await signIn(MADE, 'a-created-password'),
      'the new account cannot sign in',
    ).not.toBeNull();
  });

  it('carries the role it was created with, and not the creator role', async () => {
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    await createUser(headers, input({ role: 'user' }));

    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(MADE);

    expect((found?.user as { role?: string } | undefined)?.role).toBe('user');
  });

  it('can be created as an administrator when an administrator says so', async () => {
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    await createUser(headers, input({ role: 'admin' }));

    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(MADE);

    expect((found?.user as { role?: string } | undefined)?.role).toBe('admin');
  });

  it('is refused when the email already has an account', async () => {
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    await createUser(headers, input());

    await expect(createUser(headers, input())).rejects.toSatisfy((error) => status(error) === 400);
  });

  it('treats an email that differs only in case as the same account', async () => {
    /**
     * This one checks an assumption about Better Auth rather than about this file.
     *
     * It stores the address lowercased and matches case-insensitively, which is why
     * `createUser` does not lowercase it again. If a future version stops doing that,
     * two accounts could exist for one address and only one of them could ever sign in.
     * That is worth failing on here rather than discovering from a support message.
     */
    const headers = asHeaders(await signIn(ADMIN.email, ADMIN.password));
    await createUser(headers, input());

    await expect(createUser(headers, input({ email: MADE.toUpperCase() }))).rejects.toSatisfy(
      (error) => status(error) === 400,
    );
  });
});
