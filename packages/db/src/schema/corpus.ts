import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { VECTOR_DIMENSIONS } from '@etai/shared';

/**
 * Drizzle has no built-in tsvector type, so it is declared here. The column holds
 * the keyword-search form of a chunk and is filled in by PostgreSQL itself, which
 * means it can never drift out of step with the text it came from.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * How precisely a document can be placed in time.
 *
 * Most dates in this collection come from file names, and some of those name only a
 * month. Storing that as the first of the month and forgetting the difference would
 * make a monthly report look like it was written on a specific day, which matters as
 * soon as two documents are compared to decide which one is current.
 */
export const temporalPrecision = pgEnum('temporal_precision', ['day', 'month']);

/**
 * One row per source file.
 *
 * This table holds what a document is: where it came from, when it is from, and
 * whether it has been retired or replaced. The text that gets searched lives in
 * `chunk`, one level down.
 *
 * Three of these columns exist to answer questions that similarity alone gets
 * wrong. `isDeprecated` marks a document that announces its own retirement.
 * `supersededById` points at the next document in the same series. And
 * `temporalDate` is the only place dates live, because the files carry no metadata
 * block of their own.
 */
export const document = pgTable(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Path relative to the corpus root. Also the natural key for re-indexing. */
    path: text('path').notNull().unique(),
    title: text('title').notNull(),

    /** The whole file. Kept so a citation can be opened and read in full. */
    content: text('content').notNull(),

    /**
     * SHA-256 of the file contents. Ingestion compares this before doing any work,
     * which is what makes a re-run cheap and keeps repeated runs from duplicating
     * rows.
     */
    contentHash: text('content_hash').notNull(),

    /** Derived from the directory the file sits in, for example `deployment-report`. */
    docType: text('doc_type').notNull(),

    /** Null for the documents that genuinely have no date attached to them. */
    temporalDate: date('temporal_date'),
    temporalPrecision: temporalPrecision('temporal_precision'),

    /** For example `halcyon-runner`, with `versionNumber` holding `4.2`. */
    versionSeries: text('version_series'),
    versionNumber: text('version_number'),

    /** Set when the document announces its own retirement in its opening lines. */
    isDeprecated: boolean('is_deprecated').notNull().default(false),

    /**
     * The next document in the same series, when there is one. Derived during
     * ingestion rather than written into the files, so nothing about this particular
     * collection is hard-coded into the pipeline.
     *
     * This is not the same thing as being deprecated. A superseded release note is
     * still the correct record of what happened at the time, so ranking treats this
     * as an ordering signal rather than as a reason to push the document away.
     */
    supersededById: uuid('superseded_by_id'),

    /** Project the document belongs to, where the file name carries one. */
    project: text('project'),

    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft delete. A file that disappears from disk stops being searchable, but the
     * ingestion history that mentions it stays readable.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * Self reference, declared at table level because a column cannot point at the
     * table it is being defined in. Removing the newer document clears the pointer
     * rather than deleting the older one along with it.
     */
    foreignKey({
      columns: [table.supersededById],
      foreignColumns: [table.id],
      name: 'document_superseded_by_id_fk',
    }).onDelete('set null'),

    index('document_doc_type_idx').on(table.docType),
    index('document_temporal_date_idx').on(table.temporalDate),
    index('document_version_series_idx').on(table.versionSeries),
    index('document_deleted_at_idx').on(table.deletedAt),
  ],
);

/**
 * One row per piece of a document that gets embedded and searched.
 *
 * Splitting on headings and merging small sections up to a token budget means that
 * every file in the sample collection comes out as a single chunk, since none of
 * them approach the budget. That is the point: the same code handles a collection of
 * short notes and one of long documents without a different setting, so pointing
 * ingestion at a real corpus does not need a rewrite.
 */
export const chunk = pgTable(
  'chunk',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    documentId: uuid('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),

    /** Position within the document, starting at zero. */
    position: integer('position').notNull(),

    /**
     * The headings above this chunk, joined into a trail such as
     * `drift agent v3 > Initialization`. Kept as its own column so that keyword search
     * can match on a heading, which is often where the term a person searched for
     * actually appears.
     */
    headingPath: text('heading_path'),

    content: text('content').notNull(),

    /**
     * SHA-256 of this chunk's text. A document can change in one place, and this is
     * what lets the unchanged chunks keep their embeddings instead of paying to
     * generate them again.
     */
    contentHash: text('content_hash').notNull(),

    tokenCount: integer('token_count').notNull(),

    /**
     * Nullable so that a chunk whose embedding call failed is still recorded. The run
     * is then reported as partial and the dashboard can show exactly what has no
     * vector, instead of the whole run being lost.
     */
    embedding: vector('embedding', { dimensions: VECTOR_DIMENSIONS }),

    /** Maintained by PostgreSQL from the heading trail and the text. */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('english', coalesce(heading_path, '') || ' ' || coalesce(content, ''))`,
    ),

    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * At this collection size an exact scan would be fast enough, so this index is
     * not here for speed. It is here because the operator class has to match the
     * distance function the queries use, and getting that pairing wrong is silent:
     * the index simply never gets used. HNSW rather than IVFFlat because IVFFlat
     * needs rebuilding as rows change, and this collection is meant to be
     * re-indexed whenever the files do.
     */
    index('chunk_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),

    /** Keyword search. Exact terms such as product names are where vectors are weakest. */
    index('chunk_search_vector_gin_idx').using('gin', table.searchVector),

    index('chunk_document_id_idx').on(table.documentId),

    /** One chunk per position per document, so a re-run replaces rather than adds. */
    unique('chunk_document_position_unique').on(table.documentId, table.position),
  ],
);

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
