import { chunk, document, getDb } from '@etai/db';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/**
 * The indexed documents, as the corpus view lists them.
 *
 * All of them in one query. This corpus is 142 documents and the whole list is 20 KB of
 * JSON, so filtering happens in the browser and there is no pagination, no cursor and no
 * per-keystroke request. Server-side paging here would be machinery serving nothing: the
 * page it protects against does not exist, and the cost of adding it later is one query
 * and one component rather than a rewrite.
 *
 * `content` is deliberately not selected. The list shows metadata, and sending 111 KB of
 * document bodies to render a table of names would be paying for the whole corpus to
 * display its index.
 */

/**
 * Whether a document is actually searchable, which is not the same as being present.
 *
 * A row with no embedded chunk is in the database and invisible to vector search. Nothing
 * reports that on its own: the document exists, the corpus count includes it, and it
 * simply never comes back from a query. This is the column that makes it visible.
 */
export type IndexingStatus = 'indexed' | 'not_embedded';

export interface DocumentRow {
  id: string;
  path: string;
  title: string;
  docType: string;
  temporalDate: string | null;
  temporalPrecision: 'day' | 'month' | null;
  project: string | null;
  versionSeries: string | null;
  versionNumber: string | null;
  isDeprecated: boolean;
  /** The document that replaced this one, by path, so a reader can open it. */
  supersededByPath: string | null;
  chunks: number;
  embeddedChunks: number;
  status: IndexingStatus;
  indexedAt: Date | null;
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const successor = alias(document, 'successor');

  const rows = await getDb()
    .select({
      id: document.id,
      path: document.path,
      title: document.title,
      docType: document.docType,
      temporalDate: document.temporalDate,
      temporalPrecision: document.temporalPrecision,
      project: document.project,
      versionSeries: document.versionSeries,
      versionNumber: document.versionNumber,
      isDeprecated: document.isDeprecated,
      supersededByPath: successor.path,
      chunks: sql<number>`count(${chunk.id})::int`,
      embeddedChunks: sql<number>`count(${chunk.embedding})::int`,
      indexedAt: document.indexedAt,
    })
    .from(document)
    .leftJoin(chunk, eq(chunk.documentId, document.id))
    .leftJoin(successor, eq(successor.id, document.supersededById))
    // Soft-deleted documents are gone from search, so listing them here would show a
    // corpus that does not match what a question can reach.
    .where(isNull(document.deletedAt))
    .groupBy(document.id, successor.path)
    .orderBy(asc(document.path));

  return rows.map((row) => ({
    ...row,
    status: row.chunks > 0 && row.embeddedChunks === row.chunks ? 'indexed' : 'not_embedded',
  }));
}

/** Every type present, so the filter offers what exists rather than a hardcoded list. */
export function documentTypes(rows: DocumentRow[]): string[] {
  return [...new Set(rows.map((row) => row.docType))].sort();
}
