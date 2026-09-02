import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';
import { getEnv } from '@etai/shared/env';
import { callUpstream, VECTOR_DIMENSIONS } from '@etai/shared';

/**
 * Embeddings always come from Google, whichever provider writes the answers, because
 * the Anthropic API has no embeddings endpoint.
 */
function embeddingModel() {
  const env = getEnv();
  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY }).textEmbeddingModel(
    env.EMBEDDING_MODEL,
  );
}

/**
 * Two things are passed to the model on every call, and both matter.
 *
 * The width is asked for explicitly. The model returns 3072 numbers by default and
 * pgvector cannot build an HNSW index above 2000, so the default would leave every
 * search scanning the whole table. At 1536 the vector still comes back at unit length,
 * so cosine distance needs no extra step.
 *
 * The task type is what the text is going to be used for. A document being stored and a
 * question being asked are not the same kind of text, and telling the model which is
 * which produces vectors that are meant to be compared against each other. Embedding
 * both as though they were documents is a quiet way to lose retrieval quality.
 */
function providerOptions(taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  return {
    google: {
      outputDimensionality: VECTOR_DIMENSIONS,
      taskType,
    },
  };
}

export interface EmbedResult {
  embeddings: number[][];
  /** Tokens the provider reported, when it reports any. */
  tokens: number | undefined;
}

/**
 * Embeds text that is being stored.
 *
 * Retries and request batching are left to the SDK, which knows how many values the
 * model accepts per call and applies exponential backoff between attempts. Writing
 * either by hand would mean guessing at limits the library already knows.
 */
export async function embedDocuments(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 };

  const result = await callUpstream('embedding', () =>
    embedMany({
      model: embeddingModel(),
      values: texts,
      providerOptions: providerOptions('RETRIEVAL_DOCUMENT'),
      maxRetries: 4,
      // Kept modest on purpose. The whole collection is a few hundred values, so there
      // is nothing to gain from pushing concurrency into rate limit territory.
      maxParallelCalls: 3,
    }),
  );

  return { embeddings: result.embeddings, tokens: result.usage?.tokens };
}

/** Embeds a question. The task type is the only difference, and it is the important one. */
export async function embedQuery(text: string): Promise<number[]> {
  const result = await callUpstream('embedding', () =>
    embed({
      model: embeddingModel(),
      value: text,
      providerOptions: providerOptions('RETRIEVAL_QUERY'),
      maxRetries: 4,
    }),
  );

  return result.embedding;
}

/** pgvector reads a vector from this shape rather than from an array parameter. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
