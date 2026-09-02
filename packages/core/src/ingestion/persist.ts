import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chunk, document, getDb, ingestionItem, ingestionRun } from '@etai/db';
import { embedDocuments } from '../embedding/embed.js';
import { chunksNeedingEmbedding, diffDocuments, type DocumentAction } from './diff.js';
import { buildEmbeddingText } from './embed-text.js';
import { prepareCorpus, type PreparedDocument } from './prepare.js';

/** Mirrors the ingestion_trigger enum in the schema. */
export type IngestionTrigger = 'cli' | 'dashboard' | 'watch' | 'schedule' | 'seed';

export interface IngestOptions {
  corpusPath: string;
  trigger?: IngestionTrigger;
  triggeredByUserId?: string | undefined;
  /** Re-embeds everything, for when the model or its settings changed. */
  force?: boolean;
  /**
   * Set by watch mode when files changed while the previous run was still going. Recorded
   * on the run so the log tells a coalesced follow-up apart from an ordinary second run.
   */
  queued?: boolean;
  onProgress?: (message: string) => void;
}

export interface IngestSummary {
  runId: string;
  status: 'completed' | 'partial' | 'failed';
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  failed: number;
  chunksEmbedded: number;
  durationMs: number;
  failures: Array<{ path: string; error: string }>;
}

/**
 * Reads the corpus and brings the database in line with it.
 *
 * The shape of this is driven by one requirement: running it twice should cost almost
 * nothing and change nothing. So the first thing it does is compare hashes, and the
 * documents that come back unchanged never reach an embedding call.
 *
 * Failures are per document rather than per run. Three files failing out of 142 leaves
 * the other 139 indexed and the run marked partial, with each failure recorded against
 * the file it happened to. Rolling the whole thing back would turn a small problem into
 * having no index at all.
 */
export async function ingestCorpus(options: IngestOptions): Promise<IngestSummary> {
  const db = getDb();
  const startedAt = Date.now();
  const report = options.onProgress ?? (() => {});

  const [run] = await db
    .insert(ingestionRun)
    .values({
      status: 'running',
      trigger: options.trigger ?? 'cli',
      triggeredByUserId: options.triggeredByUserId ?? null,
      corpusPath: options.corpusPath,
      queued: options.queued ?? false,
    })
    .returning({ id: ingestionRun.id });

  const runId = run?.id;
  if (!runId) throw new Error('Could not start an ingestion run');

  const counts = { created: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 };
  const failures: Array<{ path: string; error: string }> = [];
  let chunksEmbedded = 0;

  try {
    const prepared = await prepareCorpus(options.corpusPath);
    report(`Read ${prepared.documents.length} documents from ${options.corpusPath}`);

    const stored = await db
      .select({ id: document.id, path: document.path, contentHash: document.contentHash })
      .from(document)
      .where(isNull(document.deletedAt));

    const changes = diffDocuments(prepared.documents, stored);
    const preparedByPath = new Map(prepared.documents.map((d) => [d.relativePath, d]));

    for (const change of changes) {
      const itemStarted = Date.now();
      let action: DocumentAction | 'failed' = change.action;
      let documentId = change.stored?.id ?? null;
      let error: string | null = null;

      try {
        if (change.action === 'skipped') {
          // Still worth confirming the vectors are there, since a previous run may have
          // failed after writing the document but before embedding all of its chunks.
          const repaired = await embedMissingChunks(change.stored?.id ?? null, options.force);
          chunksEmbedded += repaired;
          if (repaired > 0) action = 'updated';
        } else if (change.action === 'deleted') {
          await softDelete(change.stored?.id ?? null);
        } else {
          const incoming = preparedByPath.get(change.path);
          if (!incoming) throw new Error('Document disappeared between reading and writing');

          const result = await upsertDocument(incoming, change.stored?.id ?? null, options.force);
          documentId = result.documentId;
          chunksEmbedded += result.embedded;
        }
      } catch (thrown) {
        action = 'failed';
        error = thrown instanceof Error ? thrown.message : String(thrown);
        failures.push({ path: change.path, error });
      }

      counts[actionKey(action)] += 1;

      await db.insert(ingestionItem).values({
        runId,
        path: change.path,
        action,
        documentId,
        error,
        durationMs: Date.now() - itemStarted,
      });
    }

    // Supersedence is written after every document exists, because it points at rows by
    // id and a document cannot be linked to one that has not been inserted yet.
    await linkSupersedence(prepared.documents);

    const status = counts.failed === 0 ? 'completed' : 'partial';
    const durationMs = Date.now() - startedAt;

    await db
      .update(ingestionRun)
      .set({
        status,
        finishedAt: new Date(),
        stats: { ...counts, chunksEmbedded, durationMs },
      })
      .where(eq(ingestionRun.id, runId));

    return { runId, status, ...counts, chunksEmbedded, durationMs, failures };
  } catch (thrown) {
    // Only a failure that stopped the run itself lands here, such as the corpus
    // directory not existing. A document level problem is handled above.
    const message = thrown instanceof Error ? thrown.message : String(thrown);

    await db
      .update(ingestionRun)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(ingestionRun.id, runId));

    throw thrown;
  }
}

function actionKey(action: DocumentAction | 'failed'): keyof typeof COUNT_KEYS {
  return COUNT_KEYS[action];
}

const COUNT_KEYS = {
  created: 'created',
  updated: 'updated',
  skipped: 'skipped',
  deleted: 'deleted',
  failed: 'failed',
} as const;

/** Writes the document row and replaces the chunks that changed. */
async function upsertDocument(
  incoming: PreparedDocument,
  existingId: string | null,
  force = false,
): Promise<{ documentId: string; embedded: number }> {
  const db = getDb();

  const values = {
    path: incoming.relativePath,
    title: incoming.title,
    content: incoming.content,
    contentHash: incoming.contentHash,
    docType: incoming.docType,
    temporalDate: incoming.temporalDate,
    temporalPrecision: incoming.temporalPrecision,
    versionSeries: incoming.versionSeries,
    versionNumber: incoming.versionNumber,
    isDeprecated: incoming.isDeprecated,
    project: incoming.project,
    indexedAt: new Date(),
    updatedAt: new Date(),
    // A path that comes back after being deleted is the same document returning, not a
    // new one, so the soft delete is lifted rather than a second row created.
    deletedAt: null,
  };

  const [row] = await db
    .insert(document)
    .values(values)
    .onConflictDoUpdate({ target: document.path, set: values })
    .returning({ id: document.id });

  const documentId = row?.id ?? existingId;
  if (!documentId) throw new Error('Could not write the document row');

  const existingChunks = await db
    .select({
      position: chunk.position,
      contentHash: chunk.contentHash,
      embedding: chunk.embedding,
    })
    .from(chunk)
    .where(eq(chunk.documentId, documentId));

  const positions = force
    ? incoming.chunks.map((c) => c.position)
    : chunksNeedingEmbedding(
        incoming.chunks,
        existingChunks.map((c) => ({
          position: c.position,
          contentHash: c.contentHash,
          hasEmbedding: c.embedding !== null,
        })),
      );

  const needed = new Set(positions);
  const toEmbed = incoming.chunks.filter((c) => needed.has(c.position));

  const embeddings =
    toEmbed.length > 0
      ? (await embedDocuments(toEmbed.map((c) => buildEmbeddingText(incoming.title, c)))).embeddings
      : [];

  // Chunk positions shift when a document is edited, so the old set is cleared rather
  // than updated in place. Anything that kept its vector carries it across.
  const carried = new Map(
    existingChunks
      .filter((c) => !needed.has(c.position))
      .map((c) => [c.position, c.embedding as number[] | null]),
  );

  await db.delete(chunk).where(eq(chunk.documentId, documentId));

  if (incoming.chunks.length > 0) {
    await db.insert(chunk).values(
      incoming.chunks.map((c) => {
        const embeddedIndex = toEmbed.findIndex((candidate) => candidate.position === c.position);
        const embedding =
          embeddedIndex >= 0
            ? (embeddings[embeddedIndex] ?? null)
            : (carried.get(c.position) ?? null);

        return {
          documentId,
          position: c.position,
          headingPath: c.headingPath,
          content: c.content,
          contentHash: c.contentHash,
          tokenCount: c.tokenCount,
          embedding,
          embeddedAt: embedding ? new Date() : null,
        };
      }),
    );
  }

  return { documentId, embedded: toEmbed.length };
}

/** Fills in vectors for chunks an earlier run left without one. */
async function embedMissingChunks(documentId: string | null, force = false): Promise<number> {
  if (!documentId || force) return 0;

  const db = getDb();

  const missing = await db
    .select({
      id: chunk.id,
      position: chunk.position,
      headingPath: chunk.headingPath,
      content: chunk.content,
    })
    .from(chunk)
    .where(and(eq(chunk.documentId, documentId), isNull(chunk.embedding)));

  if (missing.length === 0) return 0;

  const [row] = await db
    .select({ title: document.title })
    .from(document)
    .where(eq(document.id, documentId));

  const { embeddings } = await embedDocuments(
    missing.map((c) => buildEmbeddingText(row?.title ?? '', c)),
  );

  for (const [index, item] of missing.entries()) {
    const embedding = embeddings[index];
    if (!embedding) continue;

    await db.update(chunk).set({ embedding, embeddedAt: new Date() }).where(eq(chunk.id, item.id));
  }

  return missing.length;
}

/**
 * Marks a document that is gone from disk and removes its chunks.
 *
 * The document row stays so that the ingestion history mentioning it still reads, but
 * the chunks go, because leaving them would keep the file answering questions after it
 * stopped existing.
 */
async function softDelete(documentId: string | null): Promise<void> {
  if (!documentId) return;

  const db = getDb();
  await db.delete(chunk).where(eq(chunk.documentId, documentId));
  await db
    .update(document)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(document.id, documentId));
}

/** Points each superseded document at its replacement, now that both have ids. */
async function linkSupersedence(documents: PreparedDocument[]): Promise<void> {
  const db = getDb();
  const links = documents.filter((d) => d.supersededByPath !== null);

  const paths = [...new Set(documents.map((d) => d.relativePath))];
  if (paths.length === 0) return;

  const rows = await db
    .select({ id: document.id, path: document.path })
    .from(document)
    .where(inArray(document.path, paths));

  const idByPath = new Map(rows.map((row) => [row.path, row.id]));

  // Clear first, so a link that no longer applies does not survive a re-index.
  await db.update(document).set({ supersededById: null }).where(inArray(document.path, paths));

  for (const item of links) {
    const from = idByPath.get(item.relativePath);
    const to = item.supersededByPath ? idByPath.get(item.supersededByPath) : undefined;
    if (!from || !to) continue;

    await db.update(document).set({ supersededById: to }).where(eq(document.id, from));
  }
}

/** Counts for the dashboard and for the tests, read straight from the database. */
export async function indexStats() {
  const db = getDb();

  const [row] = await db
    .select({
      documents: sql<number>`count(distinct ${document.id})::int`,
      chunks: sql<number>`count(${chunk.id})::int`,
      embedded: sql<number>`count(${chunk.embedding})::int`,
    })
    .from(document)
    .leftJoin(chunk, eq(chunk.documentId, document.id))
    .where(isNull(document.deletedAt));

  return row ?? { documents: 0, chunks: 0, embedded: 0 };
}
