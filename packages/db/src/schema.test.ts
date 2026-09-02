import { afterAll, describe, expect, it } from 'vitest';
import { VECTOR_DIMENSIONS } from '@etai/shared';
import { closeDb, getPool } from './index.js';

/**
 * Checks the database that the migration actually produced, not the schema file that
 * describes it.
 *
 * The distinction matters for one of these in particular. A vector index whose
 * operator class does not match the distance function in the query is not an error:
 * the query keeps returning correct rows, the index is quietly ignored, and the
 * mistake only shows up as slowness on a corpus large enough to notice. Reading the
 * schema would never catch that, so the plan is inspected instead.
 *
 * Requires the database to be running: docker compose up -d && pnpm db:migrate
 */
const pool = getPool();

afterAll(async () => {
  await closeDb();
});

async function indexDefinitions(table: string) {
  const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
    'SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1',
    [table],
  );
  return new Map(rows.map((row) => [row.indexname, row.indexdef]));
}

describe('database setup', () => {
  it('has the vector extension available', async () => {
    const { rows } = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );

    expect(rows).toHaveLength(1);
  });

  it('created every table the application expects', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = new Set(rows.map((row) => row.table_name));

    for (const table of [
      'user',
      'session',
      'account',
      'verification',
      'document',
      'chunk',
      'ingestion_run',
      'ingestion_item',
      'search_query',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('document table', () => {
  it('keeps the full text, so a citation can be opened and read', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'document' AND column_name = 'content'",
    );

    expect(rows).toHaveLength(1);
  });

  it('points superseded documents at their replacement without cascading deletes', async () => {
    const { rows } = await pool.query<{ confdeltype: string }>(
      `SELECT confdeltype
         FROM pg_constraint
        WHERE conname = 'document_superseded_by_id_fk'`,
    );

    // 'n' is SET NULL. Removing the newer document should clear the pointer rather
    // than remove the older document along with it.
    expect(rows[0]?.confdeltype).toBe('n');
  });

  it('will not accept two documents at the same path', async () => {
    const definitions = await indexDefinitions('document');
    const unique = [...definitions.values()].find(
      (definition) => definition.includes('UNIQUE') && definition.includes('(path)'),
    );

    expect(unique).toBeDefined();
  });
});

describe('chunk table', () => {
  it('stores the embedding at the width the environment check enforces', async () => {
    const { rows } = await pool.query<{ dims: number }>(
      `SELECT a.atttypmod AS dims
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'chunk' AND a.attname = 'embedding'`,
    );

    expect(rows[0]?.dims).toBe(VECTOR_DIMENSIONS);
  });

  it('keeps the keyword search column generated, so it cannot drift from the text', async () => {
    const { rows } = await pool.query<{ generation_expression: string | null }>(
      `SELECT generation_expression
         FROM information_schema.columns
        WHERE table_name = 'chunk' AND column_name = 'search_vector'`,
    );

    // Both the heading trail and the text, because the term a person searched for is
    // often in a heading.
    expect(rows[0]?.generation_expression).toContain('to_tsvector');
    expect(rows[0]?.generation_expression).toContain('heading_path');
  });

  it('has an HNSW index that names the cosine operator class', async () => {
    const definitions = await indexDefinitions('chunk');
    const hnsw = definitions.get('chunk_embedding_hnsw_idx');

    expect(hnsw).toBeDefined();
    expect(hnsw).toContain('USING hnsw');
    expect(hnsw).toContain('vector_cosine_ops');
  });

  it('has a GIN index for keyword search', async () => {
    const definitions = await indexDefinitions('chunk');
    const gin = definitions.get('chunk_search_vector_gin_idx');

    expect(gin).toBeDefined();
    expect(gin).toContain('USING gin');
  });

  it('allows one chunk per position per document, so a re-run replaces rather than adds', async () => {
    const definitions = await indexDefinitions('chunk');
    const unique = [...definitions.values()].find(
      (definition) =>
        definition.includes('UNIQUE') &&
        definition.includes('document_id') &&
        definition.includes('position'),
    );

    expect(unique).toBeDefined();
  });
});

describe('searching chunks', () => {
  const unitVector = (hotIndex: number) =>
    `[${Array.from({ length: VECTOR_DIMENSIONS }, (_, i) => (i === hotIndex ? 1 : 0)).join(',')}]`;

  async function seedTestDocument() {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO document (path, title, content, content_hash, doc_type)
       VALUES ('test/schema-fixture.md', 'AppLovin size limit', 'body', 'test-hash', 'test')
       RETURNING id`,
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Expected the fixture document to be inserted');
    return id;
  }

  async function removeTestData() {
    // Chunks go with the document, since the foreign key cascades.
    await pool.query("DELETE FROM document WHERE doc_type = 'test'");
  }

  it('orders by distance and uses the vector index to do it', async () => {
    const near = unitVector(0);
    const far = unitVector(1);
    const documentId = await seedTestDocument();

    try {
      await pool.query(
        `INSERT INTO chunk (document_id, position, heading_path, content, content_hash, token_count, embedding)
         VALUES ($1, 0, 'near', 'near chunk', 'hash-near', 3, $2::vector),
                ($1, 1, 'far',  'far chunk',  'hash-far',  3, $3::vector)`,
        [documentId, near, far],
      );

      const { rows } = await pool.query<{ position: number; distance: string }>(
        `SELECT position, (embedding <=> $1::vector) AS distance
           FROM chunk WHERE document_id = $2 ORDER BY distance`,
        [near, documentId],
      );

      expect(rows.map((row) => row.position)).toEqual([0, 1]);
      expect(Number(rows[0]?.distance)).toBeCloseTo(0, 5);
      expect(Number(rows[1]?.distance)).toBeCloseTo(1, 5);

      // With so few rows the planner would rightly prefer a sequential scan, so it is
      // asked to consider the index. If the operator class were wrong it would refuse
      // even then.
      await pool.query('SET enable_seqscan = off');
      const { rows: plan } = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM chunk ORDER BY embedding <=> $1::vector LIMIT 5`,
        [near],
      );
      await pool.query('RESET enable_seqscan');

      const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
      expect(planText).toContain('chunk_embedding_hnsw_idx');
    } finally {
      await removeTestData();
    }
  });

  it('refuses a vector of the wrong width instead of storing something unusable', async () => {
    const documentId = await seedTestDocument();

    try {
      await expect(
        pool.query(
          `INSERT INTO chunk (document_id, position, content, content_hash, token_count, embedding)
           VALUES ($1, 0, 'c', 'h', 1, '[1,2,3]'::vector)`,
          [documentId],
        ),
      ).rejects.toThrow();
    } finally {
      await removeTestData();
    }
  });

  it('finds a chunk by a word that only appears in its heading', async () => {
    const documentId = await seedTestDocument();

    try {
      await pool.query(
        `INSERT INTO chunk (document_id, position, heading_path, content, content_hash, token_count)
         VALUES ($1, 0, 'Network Specs: AppLovin', 'Ships as a single HTML file under 5 MB.', 'hash-kw', 10)`,
        [documentId],
      );

      const { rows } = await pool.query<{ position: number }>(
        `SELECT position FROM chunk
          WHERE document_id = $1
            AND search_vector @@ websearch_to_tsquery('english', $2)`,
        [documentId, 'applovin'],
      );

      expect(rows).toHaveLength(1);
    } finally {
      await removeTestData();
    }
  });

  it('removes chunks along with the document they belong to', async () => {
    const documentId = await seedTestDocument();

    await pool.query(
      `INSERT INTO chunk (document_id, position, content, content_hash, token_count)
       VALUES ($1, 0, 'text', 'hash-cascade', 1)`,
      [documentId],
    );

    await removeTestData();

    const { rows } = await pool.query('SELECT id FROM chunk WHERE document_id = $1', [documentId]);
    expect(rows).toHaveLength(0);
  });
});
