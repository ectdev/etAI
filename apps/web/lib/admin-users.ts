import type { CreateUserInput } from '@etai/shared';
import { auth } from './auth';
import { ForbiddenError, UnauthorizedError, ValidationError } from './errors';
import { decideAccess } from './session';

/**
 * Creating an account, which only an administrator can do.
 *
 * Takes the request's headers rather than reading `next/headers`, for the same reason
 * `changeOwnPassword` does: a rule that can only run inside a request scope can only be
 * tested by starting a server, and this one decides who may create an administrator.
 *
 * The password is hashed by Better Auth's own hasher and linked as a credential account,
 * which is what the seed script does. Doing it any other way would produce a row that
 * looks right and cannot sign in, because the hash would not match what sign-in verifies
 * against.
 */
export async function createUser(
  requestHeaders: Headers,
  input: CreateUserInput,
): Promise<{ id: string; email: string; role: string }> {
  const session = await auth.api.getSession({ headers: requestHeaders });

  // Administrators only. This is the one place in the application where a role is chosen
  // rather than read, so it is the one place where getting the check wrong hands somebody
  // the admin role.
  switch (decideAccess(session?.user, ['admin'])) {
    case 'allow':
      break;
    case 'signed-out':
      throw new UnauthorizedError();
    case 'suspended':
      throw new ForbiddenError('This account has been suspended');
    default:
      throw new ForbiddenError('Only an administrator can create an account');
  }

  const ctx = await auth.$context;

  /**
   * Not lowercased here, which was measured rather than assumed.
   *
   * The first version called `.toLowerCase()` and a falsification run showed removing it
   * changed nothing. Better Auth stores "CaseProbe@etai.test" as "caseprobe@etai.test"
   * and matches case-insensitively on lookup, so the call was doing the work twice.
   */
  const email = input.email.trim();

  // Checked before creating rather than caught afterwards, so the message names the
  // problem. A unique violation would surface as a 500 with a constraint name in it.
  const existing = await ctx.internalAdapter.findUserByEmail(email);

  if (existing?.user) {
    throw new ValidationError('That email already has an account', {
      issues: [{ path: 'email', message: 'That email already has an account' }],
    });
  }

  const created = await ctx.internalAdapter.createUser({
    email,
    name: input.name.trim(),
    // There is no mail server here, so an unverified account could never sign in.
    emailVerified: true,
    role: input.role,
    banned: false,
  });

  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(input.password),
  });

  return { id: created.id, email: created.email, role: input.role };
}
