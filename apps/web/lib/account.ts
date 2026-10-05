import type { ChangePasswordInput } from '@etai/shared';
import { auth } from './auth';
import { ForbiddenError, UnauthorizedError, ValidationError } from './errors';
import { decideAccess } from './session';

/**
 * Changing your own password.
 *
 * Takes the request's headers rather than reading them from `next/headers`, for the same
 * reason `decideAccess` is a plain function: a route handler that calls into the request
 * scope can only be exercised by starting a server, and this is a rule worth asserting in
 * the suite that needs no server. The route above it is the thin part.
 *
 * The one decision here that Better Auth does not make is `revokeOtherSessions`. It is
 * optional there and off unless asked for, so leaving it to the browser would put a
 * security rule in a request body. Here it is not a choice.
 *
 * Nothing in this file touches roles. An admin changing somebody else's password is user
 * administration, which this project does not have.
 */
export async function changeOwnPassword(
  requestHeaders: Headers,
  input: ChangePasswordInput,
): Promise<string[]> {
  const session = await auth.api.getSession({ headers: requestHeaders });

  // The same rule the pages and the other endpoints use, so a signed-out or suspended
  // account cannot change a password through a door the others would have closed.
  switch (decideAccess(session?.user, ['admin', 'user'])) {
    case 'allow':
      break;
    case 'signed-out':
      throw new UnauthorizedError();
    case 'suspended':
      throw new ForbiddenError('This account has been suspended');
    default:
      throw new ForbiddenError();
  }

  const changed = await auth.api.changePassword({
    headers: requestHeaders,
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      // Every other session for this account ends here. That is the point of asking for
      // the current password: if somebody else has your session, changing the password
      // takes it back from them.
      revokeOtherSessions: true,
    },
    // Revoking every session includes the one making this request, so Better Auth issues
    // a replacement and sets it as a cookie. Returned to the caller so the reply can
    // carry it, or a password change would sign you out of the browser you made it in.
    asResponse: true,
  });

  /**
   * Checked rather than caught.
   *
   * `asResponse: true` changes how failures arrive: instead of throwing an APIError, it
   * returns a Response with the status on it. The first version of this file wrapped the
   * call in a try/catch, which meant a wrong current password came back as 200 and the
   * form told the user their password had been changed when it had not. The test for it
   * is the only reason that was noticed.
   */
  if (!changed.ok) {
    const body: unknown = await changed.json().catch(() => null);
    const code = body && typeof body === 'object' && 'code' in body ? String(body.code) : '';
    const short = code.includes('SHORT');

    throw new ValidationError(
      short ? 'That password is too short' : 'That is not your current password',
      {
        issues: [
          short
            ? { path: 'newPassword', message: 'That password is too short' }
            : { path: 'currentPassword', message: 'That is not your current password' },
        ],
      },
    );
  }

  // getSetCookie rather than get, because revoking sessions can set more than one and
  // reading a single header would silently drop the rest.
  return changed.headers.getSetCookie();
}
