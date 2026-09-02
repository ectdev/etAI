export type DocumentAction = 'created' | 'updated' | 'skipped' | 'deleted';

export interface StoredDocument {
  id: string;
  path: string;
  contentHash: string;
}

export interface IncomingDocument {
  relativePath: string;
  contentHash: string;
}

export interface DocumentChange<T extends IncomingDocument = IncomingDocument> {
  action: DocumentAction;
  path: string;
  /** Present for everything except a document that has disappeared from disk. */
  incoming: T | null;
  /** Present for everything the database already knew about. */
  stored: StoredDocument | null;
}

/**
 * Decides what to do with each document by comparing hashes.
 *
 * This is what makes a second run cheap and a repeated run safe. A file whose contents
 * have not changed is skipped outright, which means no embedding call and no write, and
 * running ingestion ten times leaves the same rows as running it once.
 *
 * A document that has disappeared from disk is reported as deleted rather than ignored.
 * Leaving it in place would keep answering questions from a file that no longer exists,
 * which is worse than not finding it at all.
 */
export function diffDocuments<T extends IncomingDocument>(
  incoming: T[],
  stored: StoredDocument[],
): Array<DocumentChange<T>> {
  const storedByPath = new Map(stored.map((document) => [document.path, document]));
  const changes: Array<DocumentChange<T>> = [];

  for (const document of incoming) {
    const existing = storedByPath.get(document.relativePath);

    if (!existing) {
      changes.push({
        action: 'created',
        path: document.relativePath,
        incoming: document,
        stored: null,
      });
      continue;
    }

    changes.push({
      action: existing.contentHash === document.contentHash ? 'skipped' : 'updated',
      path: document.relativePath,
      incoming: document,
      stored: existing,
    });
  }

  const incomingPaths = new Set(incoming.map((document) => document.relativePath));

  for (const document of stored) {
    if (incomingPaths.has(document.path)) continue;
    changes.push({ action: 'deleted', path: document.path, incoming: null, stored: document });
  }

  // Stable order, so two runs over the same corpus report in the same sequence.
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export interface StoredChunk {
  position: number;
  contentHash: string;
  hasEmbedding: boolean;
}

export interface IncomingChunk {
  position: number;
  contentHash: string;
}

/**
 * Works out which chunks of a changed document actually need embedding again.
 *
 * A document usually changes in one place. Re-embedding all of its chunks because one
 * paragraph moved would be paying for work already done, so a chunk keeps its vector
 * when its own text is unchanged.
 *
 * A chunk that is unchanged but has no vector is included as well. That is the state a
 * chunk is left in when its embedding call failed on an earlier run, and the point of
 * recording that state was to be able to finish the job later.
 */
export function chunksNeedingEmbedding(incoming: IncomingChunk[], stored: StoredChunk[]): number[] {
  const storedByPosition = new Map(stored.map((chunk) => [chunk.position, chunk]));

  return incoming
    .filter((chunk) => {
      const existing = storedByPosition.get(chunk.position);
      if (!existing) return true;
      if (existing.contentHash !== chunk.contentHash) return true;
      return !existing.hasEmbedding;
    })
    .map((chunk) => chunk.position);
}
