# Choices, what they were weighed against, and where they came from

Each entry says what was chosen, what else was on the table, and why one won. Where a
measurement decided it, the measurement is in [evaluation.md](evaluation.md) and is
linked rather than repeated. Where something was turned down, the entry says what would
change that, because most of these are right for this collection at this size rather than
right in general.

## Retrieval

### Vector and keyword search, fused by rank

Chosen over vector search alone and over blending the two scores with a weight. Cosine
distance and PostgreSQL's text rank live on different scales that move independently, so
a weighted sum needs a weight that is only correct for the data it was tuned on.
Reciprocal rank fusion needs only the order each search returned, which is why it is the
usual default. On this collection keyword search earns its place with two questions that
hinge on an exact word, and the table is in
[evaluation.md](evaluation.md#measuring-retrieval).

Source: Cormack, Clarke and Büttcher,
[Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
(SIGIR 2009).

### pgvector in the database the rest of the data lives in

Chosen over a separate vector database. Documents, chunks, users, sessions and the
question log are one PostgreSQL, so a document and its vectors change in one transaction
and a filter on document type is a `WHERE` clause. The HNSW index still serves filtered
queries here, which was checked in the query plan rather than assumed. A dedicated vector
store would start to pay for itself at millions of chunks, not at a few hundred.

Sources: [pgvector](https://github.com/pgvector/pgvector); Malkov and Yashunin,
[Efficient and robust approximate nearest neighbor search using HNSW graphs](https://arxiv.org/abs/1603.09320).

### Contextual headers instead of model-written context

Anthropic's contextual retrieval has a model write 50 to 100 tokens placing each chunk in
its document before it is embedded, and reports top-20 retrieval failures falling by 35%
with that alone and by 49% together with keyword search. The cost is one model call per
chunk on every reindex.

Here the title and the heading path go in front of each chunk deterministically
(`embed-text.ts`), which is the same idea without the model. In this collection every
document comes out as a single chunk that already starts with its own title, so the gap a
written context closes is mostly closed already, and recall@5 is 66 of 67. If documents
start splitting into many chunks, where a passage from the middle really does lose its
context, this is the first thing to revisit.

Source: Anthropic, [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval).

### No cross-encoder reranker, yet

A reranker such as Cohere Rerank rescores the top results against the question and is
the step that takes the reduction in Anthropic's article from 49% to 67%. It was not added.
The right document is in the top five for 66 of 67 questions, and the answering model
reads all of them, so presence matters more here than order. Where order does fall short
is first place, 59 of 67, and that is the number a reranker would have to move. It is the
most likely next experiment, it would be judged by first place and MRR in
`pnpm eval --compare`, and it costs a network call and a second provider on every
question.

Source: [Cohere Rerank overview](https://docs.cohere.com/docs/rerank-overview).

### Hashing vectors when there is no key

CI and anyone trying the project without an account need indexing and search to work
with no key. The hashing trick, the idea behind scikit-learn's `HashingVectorizer`, maps
each word to one of 1536 buckets with a hash, uses a second hash for the sign so
collisions cancel rather than pile up, and normalises the result. It is deterministic,
needs no download and no native code, and fits the same column as the real vectors.

A small local embedding model was the alternative. It would understand meaning, which
hashing does not, at the price of a model download and a slower, heavier test run. For
CI the trade went to hashing, and the measurement says retrieval holds up: recall@5 64 of
67, because the keyword half carries it. The distances do not hold up, which is why the
refusal limit is per provider (see [evaluation.md](evaluation.md)).

Sources: [scikit-learn `HashingVectorizer`](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.HashingVectorizer.html);
Weinberger et al., [Feature Hashing for Large Scale Multitask Learning](https://arxiv.org/abs/0902.2206).

### A signature on every vector

Each stored vector records the provider, model, width and text format that made it. A
change to any of them marks the old vectors stale, the next ingestion remakes them, and
search only compares a question with vectors made the same way. Without it, switching
the embedding model leaves an index where distances between old and new vectors mean
nothing, and nothing reports it.

### Ties settled by the corpus, not by the database

Rank fusion produces ties all the time: the third result of one search and the third of
the other score exactly the same. They were settled by the chunk id, a random UUID, and the
vector query cut runs of equal distances wherever the index walk stopped, so the same
collection put different documents first on different installs. Now the database returns
every tied row (`FETCH FIRST n ROWS WITH TIES`, which keeps the HNSW index scan), and ties
are settled by the chunk's content hash and position in fusion, by arrival order in the
ranker, and by path in keyword search. A demoted document also loses the tie it lands in,
which is what giving up a place means; before, it kept its place about half the time.

Source: the PostgreSQL manual on [`FETCH FIRST ... WITH TIES`](https://www.postgresql.org/docs/current/sql-select.html#SQL-LIMIT).

## Answers

### Markdown through react-markdown

The model writes lists and code, and the corpus it reads is untrusted, so whatever renders
the answer must not execute anything in it. react-markdown builds React elements rather
than an HTML string and leaves raw HTML as text by default, and its plugin pipeline is
where the citation markers become chips. On top of that, images are dropped and links are
shown rather than followed.

Turned down: `marked` with DOMPurify, which renders to an HTML string and makes safety
depend on the sanitiser's configuration; and Vercel's streamdown, which is built for
rendering markdown while it streams in. Answers here are checked against the documents
before they are sent, so nothing streams token by token, and its extra features would be
weight without a use.

Sources: [react-markdown](https://github.com/remarkjs/react-markdown) (see its security
section); [streamdown](https://github.com/vercel/streamdown).

### One fallback model, for transient failures only

Gateways such as LiteLLM and OpenRouter route a request to another model when the first
fails. The version here is narrower on purpose: only overload, rate limit and server
errors fall back, exactly once, and the response names the model that actually answered.
An invalid key or a malformed request would fail the same way on every model behind the
same account, so retrying those elsewhere only adds latency to the error.

Sources: [LiteLLM reliability and fallbacks](https://docs.litellm.ai/docs/proxy/reliability);
[OpenRouter model routing](https://openrouter.ai/docs/features/model-routing).

### Caching the question's embedding

The chat asks the search endpoint for sources and the answer endpoint for the answer, and
both embedded the same question. An LRU cache keyed by the embedding signature and the
text pays once, and `lru-cache`'s `fetchMethod` makes two simultaneous requests for the
same key share one call instead of racing.

Source: [node-lru-cache](https://github.com/isaacs/node-lru-cache).

## The web application

### A strict Content Security Policy with a nonce per request

Following the Next.js guide: the proxy mints a nonce for each request, Next.js stamps it
on its own scripts and styles, and nothing without it runs. The consequence the guide
spells out is that every page renders per request, which costs nothing here, since every
page depends on who is signed in anyway. The experimental hash-based alternative (SRI)
keeps static pages, and was turned down for being experimental.

Two things had to change for the policy to hold. Every inline `style` attribute moved
into the stylesheet. And Zod 4 probes for `eval` with `new Function("")` the first time it
builds an object schema; the browser reports that as a violation even though Zod catches
the error, so schemas are built from a Zod configured with `jitless`, which skips the
probe. A lint rule keeps every schema on that configuration.

Sources: [Next.js, Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy);
[web.dev, Mitigate cross-site scripting with a strict CSP](https://web.dev/articles/strict-csp);
Zod's [`allowsEval` and the `jitless` setting](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/util.ts).

### Failures contained to the part that failed

The two halves of a search share nothing until they are fused, so they run side by side
with `Promise.allSettled`: the keyword query no longer waits behind an embedding call, and
either half can fail and leave the other's results. Only a failure of something outside
the code is absorbed that way (the provider, a SQLSTATE, a refused connection); a bug still
fails the request. The writes after an answer run together too, and a failed save is
reported beside the answer instead of replacing it.

On the page, each answer and each source document renders inside `catchError`, the
Next.js boundary that leaves its own `redirect()` and `notFound()` alone, so text that
cannot be formatted costs one turn and is shown plain. `error.tsx`, `global-error.tsx`
and `not-found.tsx` cover whole pages.

Every external call has a deadline: `AbortSignal.timeout` on each provider call, counted
as transient so the fallback model is tried, and `statement_timeout` and
`idle_in_transaction_session_timeout` on every database connection the application opens.

Sources: [MDN, `Promise.allSettled`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled);
[Next.js, `catchError`](https://nextjs.org/docs/app/api-reference/functions/catchError) and
[error handling files](https://nextjs.org/docs/app/api-reference/file-conventions/error);
PostgreSQL, [`statement_timeout`](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-STATEMENT-TIMEOUT)
and [`idle_in_transaction_session_timeout`](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-IDLE-IN-TRANSACTION-SESSION-TIMEOUT).

## Operations

### CI without a key, and pinned actions

The workflow runs the whole gate, a production build and the access checks over HTTP
against a fresh pgvector database, with hashing embeddings and a placeholder key that
satisfies the configuration check and can spend nothing. Third-party actions are pinned
to a commit rather than a tag, as GitHub's hardening guide recommends, since a tag can be
moved.

Source: [GitHub, security hardening for Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions).

### Waiting for the file watcher to prove it is live

On macOS `fs.watch` sits on FSEvents, and a write that lands before the stream is
delivering is never reported. Node's own test suite works around it by waiting before the
first write. The watch tests here do a handshake instead: they write a file of their own
until a run shows the watcher is listening, then start. A fixed wait is a guess about the
machine; the handshake is an observation.

Source: [nodejs/node 4f82673](https://github.com/nodejs/node/commit/4f82673139).

### Signals in tests go to the process that handles them

The watch mode test sent Ctrl-C's signal to `npx`, which relays it on macOS and not on
Linux, so the test passed on every laptop and hung on the CI runner. It now runs Node
directly with tsx as a loader, and the signal reaches the command.

Source: [tsx, Node.js enhancement](https://tsx.is/node-enhancement).

### Bearer tokens on the MCP server, for now

The MCP specification describes authorization built on OAuth, with delegation and
consent. What is here is narrower: a token this application issues, stores only as a
hash, compares in constant time, scopes and can revoke. The difference, and what closing
it would take, is in the README under future work.

Source: [Model Context Protocol, Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
