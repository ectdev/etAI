/**
 * pgvector can store vectors of almost any size, but it refuses to build an HNSW
 * index above this many dimensions. Going over the limit does not fail loudly, it
 * just silently leaves every search scanning the whole table.
 */
export const HNSW_MAX_DIMENSIONS = 2000;

/**
 * The width of the embedding column in the database.
 *
 * A vector column has a fixed size, so this number is baked into the migration
 * rather than read from the environment. It lives here so that the schema and the
 * environment check agree on one value instead of two that drift apart.
 */
export const VECTOR_DIMENSIONS = 1536;

/**
 * How long each kind of provider call may take, retries included, before it is given up.
 *
 * Without a deadline a provider that accepts the connection and never answers holds the
 * request open for as long as the HTTP client is willing to wait, with the SDK's retries
 * stacked on top. A question's embedding is small and normally back in under a second,
 * so ten seconds is generous; past it the search carries on by keyword. A batch of
 * document embeddings is the slow one. An answer can take half a minute when it is long,
 * and each model in the fallback chain gets its own allowance.
 */
export const PROVIDER_TIMEOUT_MS = {
  queryEmbedding: 10_000,
  documentEmbeddings: 120_000,
  generation: 45_000,
} as const;

/**
 * Cosine distance beyond which a question is refused without asking a model anything.
 *
 * The number comes from `pnpm eval`, which reports how far each kind of question lands
 * from the nearest chunk. The measured table lives in docs/evaluation.md, the one place
 * those numbers are kept.
 *
 * The answerable and out of scope ranges overlap, so no threshold separates them cleanly,
 * and the questions in the overlap are worth naming: Docker BuildKit cache mounts, a self
 * hosted GitLab runner, the Jenkins agent directive. They are about continuous
 * integration, the same subject as this collection, and are not in it. A number cannot
 * tell that; reading the documents can.
 *
 * So this sits above the furthest real question rather than in the middle. It turns away
 * most of the unrelated questions for free and never refuses one the collection could
 * have answered, which is the asymmetry that matters: an out of scope
 * question reaching the model costs a fraction of a cent and still gets refused
 * correctly, while a real question refused by arithmetic is simply wrong.
 *
 * One number per embedding provider, because the number belongs to the vectors, not to
 * the corpus. The hashing vectors that make a keyless run possible put every question
 * far from everything: the nearest chunk to an answerable question sits between 0.58
 * and 0.96 there, against 0.17 and 0.38 with Google's model. A single limit of 0.4
 * applied to both refused all 67 answerable questions under hashing, by arithmetic,
 * before any model saw them. Each value follows the same rule, a margin above the
 * furthest answerable question in its own measurement.
 *
 * Re-measure with `pnpm eval` under the provider in question if the embedding model
 * changes.
 */
export const RELEVANCE_DISTANCE_LIMITS = {
  google: 0.4,
  hashing: 0.97,
} as const satisfies Record<'google' | 'hashing', number>;

export type EmbeddingProviderName = keyof typeof RELEVANCE_DISTANCE_LIMITS;

/**
 * The window every question statistic on the dashboard is computed over.
 *
 * One window for the whole panel. The counts used to be split: the card titled "last 7
 * days" carried a median latency computed over every question ever recorded, and the
 * card beside it counted answered and declined over all time as well. With no recent
 * questions the page read "0 in the last 7 days, median 56.4 s" beside "9 answered",
 * numbers from two different periods presented as one.
 */
export const QUESTION_WINDOW_DAYS = 7;
