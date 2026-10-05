import { and, eq, isNull } from 'drizzle-orm';
import { document, getDb } from '@etai/db';

export interface StoredDocumentDetail {
  id: string;
  path: string;
  title: string;
  content: string;
  docType: string;
  temporalDate: string | null;
  temporalPrecision: 'day' | 'month' | null;
  isDeprecated: boolean;
  supersededByPath: string | null;
  project: string | null;
  versionSeries: string | null;
  versionNumber: string | null;
  /** Null only for a row written before the column existed, which no live row is. */
  indexedAt: Date | null;
}

/**
 * Reads one indexed document, by the path a citation names.
 *
 * The path is a database key here, not a filesystem path. Nothing in this function
 * touches the disk: the value goes into an equality comparison against a column, so
 * `../../etc/passwd` is a string that matches no row rather than a traversal. That is
 * worth being explicit about, because this is the one function an MCP client can hand an
 * arbitrary string to, and the usual defence for that is a sanitiser somebody has to
 * remember to call.
 *
 * Documents removed from disk keep their row so the ingestion history that mentions them
 * still reads, but they are not returned here, because a caller asking for a document by
 * path wants one that is still in the corpus.
 */
export async function getDocumentByPath(path: string): Promise<StoredDocumentDetail | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: document.id,
      path: document.path,
      title: document.title,
      content: document.content,
      docType: document.docType,
      temporalDate: document.temporalDate,
      temporalPrecision: document.temporalPrecision,
      isDeprecated: document.isDeprecated,
      supersededById: document.supersededById,
      project: document.project,
      versionSeries: document.versionSeries,
      versionNumber: document.versionNumber,
      indexedAt: document.indexedAt,
    })
    .from(document)
    .where(and(eq(document.path, path), isNull(document.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Resolved separately rather than with a join, because it is null for all but five
  // documents and the join would be paid for on every call.
  let supersededByPath: string | null = null;

  if (row.supersededById) {
    const replacement = await db
      .select({ path: document.path })
      .from(document)
      .where(eq(document.id, row.supersededById))
      .limit(1);
    supersededByPath = replacement[0]?.path ?? null;
  }

  const { supersededById: _ignored, ...rest } = row;

  return { ...rest, supersededByPath };
}
