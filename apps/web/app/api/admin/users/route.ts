import { headers } from 'next/headers';
import { createUserSchema } from '@etai/shared';
import { createUser } from '@/lib/admin-users';
import { handler, json, readJson } from '@/lib/route';

/**
 * Creating an account.
 *
 * Thin on purpose. The rule, including the administrator check, is in `lib/admin-users.ts`
 * where it can be tested without a running server.
 */
export const POST = handler(async (request) => {
  const input = await readJson(request, createUserSchema);
  const created = await createUser(await headers(), input);

  // The password is never echoed, not even the one that was just sent.
  return json({ id: created.id, email: created.email, role: created.role }, 201);
});
