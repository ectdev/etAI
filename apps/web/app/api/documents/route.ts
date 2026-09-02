import { getDocumentByPath } from '@etai/core';
import { documentPathSchema } from '@etai/shared';
import { NotFoundError } from '@/lib/errors';
import { handler, json } from '@/lib/route';
import { requireRole } from '@/lib/session';

/**
 * Reads one indexed document, by the path a citation names.
 *
 * Added for the source panel, which opens the document behind a citation rather than
 * sending somebody to a raw file. Nothing else could serve it: the two existing endpoints
 * return passages and answers, and a chunk is not the document a reader wants to see.
 *
 * The path is a database key rather than a filesystem path, so `../../etc/passwd` matches
 * no row instead of escaping anywhere. That is a property of the lookup rather than of a
 * validator, which is why there is no sanitiser here to forget to call.
 *
 * A GET with a query parameter rather than a path segment, because a document path
 * contains slashes and encoding them into a route segment makes the caller do work the
 * query string already does.
 */
export const GET = handler(async (request) => {
  await requireRole('admin', 'user');

  const url = new URL(request.url);
  const input = documentPathSchema.parse({ path: url.searchParams.get('path') ?? '' });

  const found = await getDocumentByPath(input.path);
  if (!found) throw new NotFoundError('No indexed document has that path');

  return json({
    path: found.path,
    title: found.title,
    docType: found.docType,
    content: found.content,
    temporalDate: found.temporalDate,
    temporalPrecision: found.temporalPrecision,
    project: found.project,
    versionSeries: found.versionSeries,
    versionNumber: found.versionNumber,
    isDeprecated: found.isDeprecated,
    supersededByPath: found.supersededByPath,
    indexedAt: found.indexedAt,
  });
});
