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
 * Cosine distance beyond which a question is refused without asking a model anything.
 *
 * The number comes from `pnpm eval`, which runs 71 questions and reports where each kind
 * of question lands. Across 33 questions the collection can answer, the furthest was
 * 0.3304. Across 34 that have nothing to do with it, the nearest was 0.3135.
 *
 * Those two ranges overlap, so no threshold separates them cleanly, and the three that
 * cause the overlap are worth naming: questions about running ad campaigns, mobile game
 * monetisation and App Store policy. They sound like this collection and are not in it.
 * A number cannot tell that; reading the documents can.
 *
 * So this sits well above the furthest real question rather than in the middle. It turns
 * away roughly two thirds of the nonsense for free and never refuses a question the
 * collection could have answered, which is the asymmetry that matters: an out of scope
 * question reaching the model costs a fraction of a cent and still gets refused
 * correctly, while a real question refused by arithmetic is simply wrong.
 *
 * Re-measure with `pnpm eval` if the embedding model changes. The number belongs to the
 * model, not to the corpus.
 */
export const RELEVANCE_DISTANCE_LIMIT = 0.4;
