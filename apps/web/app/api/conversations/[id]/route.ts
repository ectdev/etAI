import { deleteConversation } from '@/lib/conversations';
import { NotFoundError } from '@/lib/errors';
import { handler, json } from '@/lib/route';
import { requireRole } from '@/lib/session';

/**
 * Deleting a conversation.
 *
 * The owner goes into the query rather than being checked after the row is read, so
 * somebody else's conversation is not found rather than found and refused. That also
 * means a request for an id that belongs to another account gets the same 404 as one that
 * was never real, and cannot be used to discover which ids exist.
 *
 * The turns go with it through the foreign key.
 */
export const DELETE = handler(async (request) => {
  const session = await requireRole('admin', 'user');

  // Read from the URL rather than from a route context, so this handler can be called
  // with a plain Request in a test.
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';

  const removed = await deleteConversation(id, session.user.id);
  if (!removed) throw new NotFoundError('That conversation does not exist');

  return json({ ok: true });
});
