import { headers } from 'next/headers';
import { changePasswordSchema } from '@etai/shared';
import { changeOwnPassword } from '@/lib/account';
import { handler, json, readJson } from '@/lib/route';

/**
 * Changing your own password.
 *
 * Thin on purpose. The rule, including the session check and the decision to end every
 * other session, is in `lib/account.ts` where it can be tested without a running server.
 */
export const POST = handler(async (request) => {
  const input = await readJson(request, changePasswordSchema);
  const cookies = await changeOwnPassword(await headers(), input);

  const reply = json({ ok: true });
  for (const cookie of cookies) reply.headers.append('set-cookie', cookie);

  return reply;
});
