import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { chunk, document, getDb, ingestionItem, ingestionRun } from '@etai/db';
import { embedDocuments, embeddingSignature } from '../embedding/embed.js';
import { chunksNeedingEmbedding, diffDocuments, type DocumentAction } from './diff.js';
import { buildEmbeddingText } from './embed-text.js';
import { prepareCorpus, type PreparedDocument } from './prepare.js';

/** Mirrors the ingestion_trigger enum in the schema. */
export type IngestionTrigger = 'cli' | 'dashboard' | 'watch' | 'schedule' | 'seed';

export interface IngestOptions {
  corpusPath: string;
  trigger?: IngestionTrigger;
  triggeredByUserId?: string | undefined;
  /**
   * Re-embeds every chunk, unchanged ones included.
   *
   * Rarely needed now: a vector made by a different model or text format is detected from
   * its signature and made again without this. What it is still for is a provider that
   * changed its weights behind an unchanged model name.
   */
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
 * Failures are per document rather than per run. Three files failing out of 131 leaves
 * the other 139 indexed and the run marked partial, with each failure recorded against
 * the file it happened to. Rolling the whole thing back would turn a small problem into
 * having no index at all.
 */
/**
 * How long a run may say it is running before it is taken to have died.
 *
 * A full reindex of the sample collection takes under two minutes, so a run still open
 * after fifteen did not finish: its process was killed, or the machine went to sleep and
 * never came back to it. Such a run cannot close itself, so the next one does.
 */
export const STALE_RUN_MINUTES = 15;

export const INTERRUPTED_RUN_ERROR =
  'Interrupted: the process ended before the run finished. Nothing it left half written is kept, and the next run redoes it.';

export async function ingestCorpus(options: IngestOptions): Promise<IngestSummary> {
  const db = getDb();
  const startedAt = Date.now();
  const report = options.onProgress ?? (() => {});

  await db
    .update(ingestionRun)
    .set({ status: 'failed', finishedAt: new Date(), error: INTERRUPTED_RUN_ERROR })
    .where(
      and(
        eq(ingestionRun.status, 'running'),
        sql`${ingestionRun.startedAt} < now() - make_interval(mins => ${STALE_RUN_MINUTES})`,
      ),
    );

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
  // Read once, so a run cannot write two signatures if the environment changes under it.
  const signature = embeddingSignature();
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

    const chunkCounts = new Map(
      (
        await db
          .select({ documentId: chunk.documentId, count: sql<number>`count(*)::int` })
          .from(chunk)
          .groupBy(chunk.documentId)
      ).map((row) => [row.documentId, row.count]),
    );

    for (const change of changes) {
      const itemStarted = Date.now();
      let action: DocumentAction | 'failed' = change.action;
      let documentId = change.stored?.id ?? null;
      let error: string | null = null;

      try {
        const incoming = preparedByPath.get(change.path);
        const storedChunks = chunkCounts.get(change.stored?.id ?? '') ?? 0;

        if (change.action === 'skipped' && incoming && storedChunks !== incoming.chunks.length) {
          // The text matches and the chunks do not. Before writes were atomic, a run
          // killed between the document row and its chunks left exactly this: a document
          // every later run skipped as unchanged and search could never find. It is
          // rebuilt rather than trusted.
          const result = await upsertDocument(
            incoming,
            change.stored?.id ?? null,
            signature,
            options.force,
          );
          documentId = result.documentId;
          chunksEmbedded += result.embedded;
          action = 'updated';
        } else if (change.action === 'skipped') {
          // Unchanged text can still need new vectors: a previous run may have failed
          // before embedding every chunk, the vectors may have been made by a different
          // model, or --force asked for all of them again.
          const repaired = await embedStaleChunks(
            change.stored?.id ?? null,
            signature,
            options.force,
          );
          chunksEmbedded += repaired;
          if (repaired > 0) action = 'updated';
        } else if (change.action === 'deleted') {
          await softDelete(change.stored?.id ?? null);
        } else {
          if (!incoming) throw new Error('Document disappeared between reading and writing');

          const result = await upsertDocument(
            incoming,
            change.stored?.id ?? null,
            signature,
            options.force,
          );
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
  signature: string,
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

  // Read by path rather than by id, so a document returning after a soft delete finds
  // whatever it left behind.
  const existingChunks = await db
    .select({
      position: chunk.position,
      contentHash: chunk.contentHash,
      embedding: chunk.embedding,
      embeddedWith: chunk.embeddedWith,
      embeddedAt: chunk.embeddedAt,
    })
    .from(chunk)
    .innerJoin(document, eq(chunk.documentId, document.id))
    .where(eq(document.path, incoming.relativePath));

  const positions = force
    ? incoming.chunks.map((c) => c.position)
    : chunksNeedingEmbedding(
        incoming.chunks,
        existingChunks.map((c) => ({
          position: c.position,
          contentHash: c.contentHash,
          hasEmbedding: c.embedding !== null,
          embeddedWith: c.embeddedWith,
        })),
        signature,
      );

  const needed = new Set(positions);
  const toEmbed = incoming.chunks.filter((c) => needed.has(c.position));

  // The slow part, and the one most likely to fail, happens before anything is written.
  // A process that dies here leaves the index exactly as the last finished run left it,
  // and the next run sees the same change and does it again.
  const embeddings =
    toEmbed.length > 0
      ? (await embedDocuments(toEmbed.map((c) => buildEmbeddingText(incoming.title, c)))).embeddings
      : [];

  // Chunk positions shift when a document is edited, so the old set is cleared rather
  // than updated in place. Anything that kept its vector carries it across.
  const carried = new Map(
    existingChunks
      .filter((c) => !needed.has(c.position))
      .map((c) => [
        c.position,
        { embedding: c.embedding as number[] | null, with: c.embeddedWith, at: c.embeddedAt },
      ]),
  );

  /**
   * The row and its chunks change together or not at all.
   *
   * They used to be written one after the other, with the embedding call in between. A
   * run killed there stored the new content hash beside the old chunks, or beside none,
   * and every later run skipped the document as unchanged: a new document never became
   * searchable, and an edited one kept answering with its old text.
   */
  const documentId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(document)
      .values(values)
      .onConflictDoUpdate({ target: document.path, set: values })
      .returning({ id: document.id });

    const id = row?.id ?? existingId;
    if (!id) throw new Error('Could not write the document row');

    await tx.delete(chunk).where(eq(chunk.documentId, id));

    if (incoming.chunks.length > 0) {
      await tx.insert(chunk).values(
        incoming.chunks.map((c) => {
          const embeddedIndex = toEmbed.findIndex((candidate) => candidate.position === c.position);
          const kept = carried.get(c.position);
          const embedding =
            embeddedIndex >= 0 ? (embeddings[embeddedIndex] ?? null) : (kept?.embedding ?? null);
          const embeddedWith =
            embedding === null ? null : embeddedIndex >= 0 ? signature : (kept?.with ?? null);

          return {
            documentId: id,
            position: c.position,
            headingPath: c.headingPath,
            content: c.content,
            contentHash: c.contentHash,
            tokenCount: c.tokenCount,
            embedding,
            // A carried vector keeps the time it was actually made.
            embeddedAt:
              embedding === null ? null : embeddedIndex >= 0 ? new Date() : (kept?.at ?? null),
            embeddedWith,
          };
        }),
      );
    }

    return id;
  });

  return { documentId, embedded: toEmbed.length };
}

/** Fills in vectors for chunks an earlier run left without one. */
async function embedStaleChunks(
  documentId: string | null,
  signature: string,
  force = false,
): Promise<number> {
  if (!documentId) return 0;

  const db = getDb();

  // `is distinct from` rather than `<>`, because a null signature has to count as
  // different and `<>` against null is neither true nor false.
  const stale = await db
    .select({
      id: chunk.id,
      position: chunk.position,
      headingPath: chunk.headingPath,
      content: chunk.content,
    })
    .from(chunk)
    .where(
      force
        ? eq(chunk.documentId, documentId)
        : and(
            eq(chunk.documentId, documentId),
            or(isNull(chunk.embedding), sql`${chunk.embeddedWith} is distinct from ${signature}`),
          ),
    );

  if (stale.length === 0) return 0;

  const [row] = await db
    .select({ title: document.title })
    .from(document)
    .where(eq(document.id, documentId));

  const { embeddings } = await embedDocuments(
    stale.map((c) => buildEmbeddingText(row?.title ?? '', c)),
  );

  for (const [index, item] of stale.entries()) {
    const embedding = embeddings[index];
    if (!embedding) continue;

    await db
      .update(chunk)
      .set({ embedding, embeddedAt: new Date(), embeddedWith: signature })
      .where(eq(chunk.id, item.id));
  }

  return stale.length;
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

  // Together, for the same reason as the write: a live document with no chunks is one
  // search cannot find and nothing reports.
  await getDb().transaction(async (tx) => {
    await tx.delete(chunk).where(eq(chunk.documentId, documentId));
    await tx
      .update(document)
      .set({ deletedAt: new Date(), updatedAt: new Date(), supersededById: null })
      .where(eq(document.id, documentId));
  });
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
/**
 * What the index holds. `searchable` counts the vectors made with the current signature,
 * which are the only ones a question can be compared against, so it is the number that
 * tells a stale index from a healthy one; `embedded` counts any vector at all.
 */
export async function indexStats() {
  const db = getDb();
  const signature = embeddingSignature();

  const [row] = await db
    .select({
      documents: sql<number>`count(distinct ${document.id})::int`,
      chunks: sql<number>`count(${chunk.id})::int`,
      embedded: sql<number>`count(${chunk.embedding})::int`,
      searchable: sql<number>`count(*) filter (where ${chunk.embedding} is not null and ${chunk.embeddedWith} = ${signature})::int`,
    })
    .from(document)
    .leftJoin(chunk, eq(chunk.documentId, document.id))
    .where(isNull(document.deletedAt));

  return { ...(row ?? { documents: 0, chunks: 0, embedded: 0, searchable: 0 }), signature };
}
