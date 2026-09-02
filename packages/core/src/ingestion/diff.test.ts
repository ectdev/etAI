import { describe, expect, it } from 'vitest';
import { chunksNeedingEmbedding, diffDocuments, type StoredDocument } from './diff.js';

const incoming = (relativePath: string, contentHash: string) => ({ relativePath, contentHash });
const stored = (path: string, contentHash: string, id = `id-${path}`): StoredDocument => ({
  id,
  path,
  contentHash,
});

describe('diffDocuments', () => {
  it('creates documents the database has never seen', () => {
    const changes = diffDocuments([incoming('a.md', 'hash-a')], []);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.action).toBe('created');
  });

  it('skips a document whose contents are unchanged', () => {
    const changes = diffDocuments([incoming('a.md', 'hash-a')], [stored('a.md', 'hash-a')]);

    expect(changes[0]?.action).toBe('skipped');
  });

  it('updates a document whose contents changed', () => {
    const changes = diffDocuments([incoming('a.md', 'hash-new')], [stored('a.md', 'hash-old')]);

    expect(changes[0]?.action).toBe('updated');
    expect(changes[0]?.stored?.id).toBe('id-a.md');
  });

  it('reports a document that is gone from disk', () => {
    const changes = diffDocuments([], [stored('gone.md', 'hash')]);

    expect(changes[0]?.action).toBe('deleted');
    expect(changes[0]?.incoming).toBeNull();
  });

  it('skips everything when nothing changed, which is what makes a re-run cheap', () => {
    const files = Array.from({ length: 142 }, (_, i) => incoming(`doc-${i}.md`, `hash-${i}`));
    const rows = files.map((file) => stored(file.relativePath, file.contentHash));

    const changes = diffDocuments(files, rows);

    expect(changes).toHaveLength(142);
    expect(changes.every((change) => change.action === 'skipped')).toBe(true);
  });

  it('handles a mixed run without confusing one document for another', () => {
    const changes = diffDocuments(
      [incoming('same.md', 'h1'), incoming('changed.md', 'h2-new'), incoming('new.md', 'h3')],
      [stored('same.md', 'h1'), stored('changed.md', 'h2-old'), stored('gone.md', 'h4')],
    );

    const byPath = new Map(changes.map((change) => [change.path, change.action]));

    expect(byPath.get('same.md')).toBe('skipped');
    expect(byPath.get('changed.md')).toBe('updated');
    expect(byPath.get('new.md')).toBe('created');
    expect(byPath.get('gone.md')).toBe('deleted');
  });

  it('reports in a stable order', () => {
    const changes = diffDocuments(
      [incoming('b.md', 'h'), incoming('a.md', 'h')],
      [stored('c.md', 'h')],
    );

    expect(changes.map((change) => change.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });
});

describe('chunksNeedingEmbedding', () => {
  it('asks for nothing when every chunk is unchanged and already embedded', () => {
    const result = chunksNeedingEmbedding(
      [{ position: 0, contentHash: 'a' }],
      [{ position: 0, contentHash: 'a', hasEmbedding: true }],
    );

    expect(result).toEqual([]);
  });

  it('asks only for the chunk whose text changed', () => {
    const result = chunksNeedingEmbedding(
      [
        { position: 0, contentHash: 'a' },
        { position: 1, contentHash: 'b-new' },
        { position: 2, contentHash: 'c' },
      ],
      [
        { position: 0, contentHash: 'a', hasEmbedding: true },
        { position: 1, contentHash: 'b-old', hasEmbedding: true },
        { position: 2, contentHash: 'c', hasEmbedding: true },
      ],
    );

    expect(result).toEqual([1]);
  });

  it('asks for a chunk that is unchanged but never got a vector', () => {
    // This is the state an earlier failed run leaves behind, and finishing it later is
    // the reason that state is recorded rather than thrown away.
    const result = chunksNeedingEmbedding(
      [{ position: 0, contentHash: 'a' }],
      [{ position: 0, contentHash: 'a', hasEmbedding: false }],
    );

    expect(result).toEqual([0]);
  });

  it('asks for a chunk that did not exist before', () => {
    const result = chunksNeedingEmbedding(
      [
        { position: 0, contentHash: 'a' },
        { position: 1, contentHash: 'b' },
      ],
      [{ position: 0, contentHash: 'a', hasEmbedding: true }],
    );

    expect(result).toEqual([1]);
  });

  it('asks for everything when the document is new', () => {
    const result = chunksNeedingEmbedding(
      [
        { position: 0, contentHash: 'a' },
        { position: 1, contentHash: 'b' },
      ],
      [],
    );

    expect(result).toEqual([0, 1]);
  });
});
