import { searchChunks } from '@etai/core';
import { searchInputSchema } from '@etai/shared';
import { handler, json, readJson } from '@/lib/route';
import { requireRole } from '@/lib/session';
import { searchForRole } from '@/lib/visibility';

/**
 * Search without generating an answer.
 *
 * Separate from asking a question because they cost different amounts and answer
 * different needs. A search is one embedding call and two queries; an answer adds a
 * model call on top. The dashboard and anyone exploring the collection want the first.
 */
export const POST = handler(async (request) => {
  // Both roles may search. The check is here rather than only in middleware because
  // middleware matches paths, and a path it does not match is a path it does not guard.
  const session = await requireRole('admin', 'user');

  const input = await readJson(request, searchInputSchema);

  const result = await searchChunks(input.query, {
    limit: input.limit,
    docType: input.docType,
  });

  // Cut by role here rather than in the interface. Distances and timings are for
  // somebody inspecting the system, and a field hidden with CSS has still been sent.
  return json(searchForRole(result, session.user.role === 'admin'));
});
