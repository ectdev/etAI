import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { auth } from './auth';
import { changeOwnPassword } from './account';

/**
 * Changing your own password, against the real database and through the real endpoint.
 *
 * Called with a session cookie in a Headers object, the way the route hands it over,
 * rather than calling Better Auth directly. The thing being checked is a decision this
 * project makes on top of the library: `revokeOtherSessions` is optional in Better Auth
 * and defaults to off. A test that called the library and passed the flag itself would
 * prove the library works and say nothing about whether this application asks for it.
 *
 * Requires the database: docker compose up -d && pnpm db:migrate
 */

const ACCOUNT = {
  email: 'password-change@etai.test',
  name: 'Password Change',
  password: 'first-password-1234',
} as const;

const NEXT_PASSWORD = 'second-password-5678';

async function removeAccount() {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(ACCOUNT.email);
  if (found?.user) await ctx.internalAdapter.deleteUser(found.user.id);
}

/** Signs in and returns the session cookie, which is how a browser would arrive. */
async function signIn(password: string): Promise<string | null> {
  const response = await auth.api.signInEmail({
    body: { email: ACCOUNT.email, password },
    asResponse: true,
  });

  if (!response.ok) return null;

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

  return cookie.length > 0 ? cookie : null;
}

/** How many sessions this account currently has. */
async function sessionCount(): Promise<number> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(ACCOUNT.email);
  if (!found?.user) return 0;

  const sessions = await ctx.internalAdapter.listSessions(found.user.id);
  return sessions.length;
}

/** Calls the rule, returning the status it would produce rather than throwing. */
async function change(
  cookie: string,
  body: { currentPassword: string; newPassword: string; confirmPassword: string },
): Promise<{ status: number; cookies: string[] }> {
  try {
    const cookies = await changeOwnPassword(new Headers({ cookie }), body);
    return { status: 200, cookies };
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return { status, cookies: [] };
  }
}

beforeEach(async () => {
  const ctx = await auth.$context;
  await removeAccount();

  const created = await ctx.internalAdapter.createUser({
    email: ACCOUNT.email,
    name: ACCOUNT.name,
    emailVerified: true,
    role: 'user',
  });

  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(ACCOUNT.password),
  });
});

afterAll(async () => {
  await removeAccount();
  await closeDb();
});

describe('changing your own password', () => {
  it('refuses a wrong current password, and leaves the old one working', async () => {
    const cookie = await signIn(ACCOUNT.password);
    expect(cookie, 'could not sign in to begin with').not.toBeNull();

    const response = await change(cookie as string, {
      currentPassword: 'not-the-current-one',
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });

    expect(response.status).toBe(400);

    // The password did not change. Without this the assertion above would pass for an
    // endpoint that rejected the response while having already written the new hash.
    expect(await signIn(ACCOUNT.password), 'the old password stopped working').not.toBeNull();
    expect(await signIn(NEXT_PASSWORD), 'the new password was set anyway').toBeNull();
  });

  it('takes effect on the next sign-in, and the old password stops working', async () => {
    const cookie = await signIn(ACCOUNT.password);

    const response = await change(cookie as string, {
      currentPassword: ACCOUNT.password,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });

    expect(response.status).toBe(200);

    expect(await signIn(NEXT_PASSWORD), 'the new password does not work').not.toBeNull();
    expect(await signIn(ACCOUNT.password), 'the old password still works').toBeNull();
  });

  it('drops the account other sessions, which Better Auth does not do by default', async () => {
    /**
     * The reason this endpoint exists rather than calling the library from the browser.
     * `revokeOtherSessions` is optional there and off unless asked for, so a password
     * changed because somebody else has your session would leave them signed in.
     *
     * Three sessions, then a change from the third. Two must be gone.
     */
    await signIn(ACCOUNT.password);
    await signIn(ACCOUNT.password);
    const cookie = await signIn(ACCOUNT.password);

    expect(await sessionCount(), 'the three sign-ins did not produce three sessions').toBe(3);

    const response = await change(cookie as string, {
      currentPassword: ACCOUNT.password,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });

    expect(response.status).toBe(200);

    // One, not zero: the caller is issued a replacement so a password change does not
    // sign you out of the browser you changed it in.
    expect(await sessionCount(), 'other sessions survived the change').toBe(1);
  });

  it('sends the replacement session cookie back to the caller', async () => {
    // Without this the response is a success that logs the caller out, because the
    // revocation above includes the session making the request.
    const cookie = await signIn(ACCOUNT.password);

    const response = await change(cookie as string, {
      currentPassword: ACCOUNT.password,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });

    expect(response.cookies.length).toBeGreaterThan(0);
  });

  it('refuses a new password shorter than the seed uses', async () => {
    const cookie = await signIn(ACCOUNT.password);

    const response = await change(cookie as string, {
      currentPassword: ACCOUNT.password,
      newPassword: 'short',
      confirmPassword: 'short',
    });

    expect(response.status).toBe(400);
    expect(await signIn(ACCOUNT.password), 'a short password was accepted').not.toBeNull();
  });

  it('refuses a signed-out request before looking at the body', async () => {
    const response = await change('', {
      currentPassword: ACCOUNT.password,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(
      await signIn(ACCOUNT.password),
      'a signed-out request changed the password',
    ).not.toBeNull();
  });
});
