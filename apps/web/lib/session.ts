import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, isRole, type Role, type Session } from './auth';
import { ForbiddenError, UnauthorizedError } from './errors';

/** Just enough of a user to decide whether they are allowed in. */
export interface AccessSubject {
  role?: string | null | undefined;
  banned?: boolean | null | undefined;
}

export type AccessDecision = 'allow' | 'signed-out' | 'suspended' | 'wrong-role';

/**
 * The whole authorisation rule, with nothing else attached to it.
 *
 * It is a plain function of a user and a list of roles so that it can be tested
 * directly. The two callers below differ only in what they do with the answer, and
 * writing the rule once means a page and an API route cannot come to different
 * conclusions about the same account.
 */
export function decideAccess(
  subject: AccessSubject | null | undefined,
  allowed: readonly Role[],
): AccessDecision {
  if (!subject) return 'signed-out';

  // A suspended account is turned away before its role is considered. Leaving the
  // session usable would let someone keep working until it happened to expire.
  if (subject.banned) return 'suspended';

  const role = subject.role;
  if (!isRole(role) || !allowed.includes(role)) return 'wrong-role';

  return 'allow';
}

/** Reads the session, or null when nobody is signed in. */
export async function getSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Requires one of the given roles, for an API route or a server action.
 *
 * This is called even on paths the middleware already guards. The middleware only
 * inspects a cookie, and it does not run for every way a handler can be reached, so
 * treating it as the single gate would mean one missed matcher pattern becomes an
 * open endpoint.
 */
export async function requireRole(...allowed: Role[]): Promise<Session> {
  const session = await getSession();

  switch (decideAccess(session?.user, allowed)) {
    case 'allow':
      return session as Session;
    case 'signed-out':
      throw new UnauthorizedError();
    case 'suspended':
      throw new ForbiddenError('This account has been suspended');
    case 'wrong-role':
      throw new ForbiddenError();
  }
}

/**
 * The same rule, expressed the way a page needs it.
 *
 * An API client is best served by a status code, but a person following a link is
 * better served by ending up somewhere useful. Throwing here would show a server error
 * page for what is really an ordinary answer: this is not yours to see.
 */
export async function requireRoleForPage(
  allowed: readonly Role[],
  /** Where to come back to after signing in. The page knows this; the helper cannot. */
  returnTo: string,
): Promise<Session> {
  const session = await getSession();
  const decision = decideAccess(session?.user, allowed);

  if (decision === 'signed-out') {
    redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  }

  if (decision !== 'allow') {
    redirect('/');
  }

  return session as Session;
}
