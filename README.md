# etAI

etAI is a document search system. It reads a folder of markdown files, turns each
document into a vector, and lets you search that collection by meaning rather than by
exact wording. On top of the results it writes an answer and shows which documents the
answer came from.

If the documents do not contain the answer, the system says so instead of making
something up. It can also tell you when it found only part of one, which matters when a
question touches a topic the collection mentions but never explains.

The same search runs behind two surfaces: a chat page for asking questions, and an MCP
server so an assistant such as Claude Desktop can call the search as a tool.

### The sample collection

`corpus/` holds 131 markdown files describing a fictional company called Halcyon that
runs continuous integration pipelines for other people. Point `CORPUS_PATH` somewhere else
and the pipeline indexes that instead; the sample is here so the system can be run and
measured the moment it is cloned.

It is written rather than collected, and the difficulties in it are deliberate. There are
two versions of the same build agent guide, one retired and one current, and the current
one says "It supersedes v2" three lines in, so a rule that looks for words about
deprecation marks the wrong document. There is a decision made in one release note and
reversed by the next, with eight later notes after it. Azure is named in six customer
briefs as somewhere a customer already runs and specified nowhere, which is a question the
collection can neither answer nor honestly refuse. And 87 of the 131 files come from two
templates, with whole sentences repeated word for word, which is what a search has to see
past. Each of those is a failure this system is built to survive, and each one is
measured in [docs/evaluation.md](docs/evaluation.md).

## Features

| Area                                           | Where it is explained                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Monorepo with shared types across the boundary | [Project layout](docs/architecture.md#project-layout)                  |
| Ingestion pipeline that can rerun safely       | [Re-running ingestion](docs/retrieval.md#re-running-ingestion)         |
| Hybrid retrieval: vector and keyword by rank   | [Measuring retrieval](docs/evaluation.md#measuring-retrieval)          |
| Reranking on what is known about a document    | [Ranking](docs/retrieval.md#ranking-on-what-is-known-about-a-document) |
| Answers with citations, and honest refusals    | [Answering](docs/retrieval.md#answering)                               |
| An evaluation over 106 questions, reported     | [Measuring retrieval](docs/evaluation.md#measuring-retrieval)          |
| Search that keeps working without embeddings   | [Errors](#errors)                                                      |
| Login with role based access                   | [How access is decided](docs/architecture.md#how-access-is-decided)    |
| Chat page and an administrator dashboard       | [The interface](docs/architecture.md#decisions-in-the-interface)       |
| Conversations kept and reopened                | [Conversations](#conversations)                                        |
| Password changes, and accounts an admin adds   | [Accounts](#accounts)                                                  |
| MCP server over stdio and HTTP                 | [Connecting an MCP client](#connecting-an-mcp-client)                  |

### What is built, and what is not

Three things are deliberately absent rather than unfinished, and the reasons differ.

**Authorization on the MCP server over OIDC.** What stands in its place is a bearer token
this application issues, hashes and can revoke. What it does not do is delegation, and the
difference is under [future work](#future-work).

**Managing other people's accounts.** Anyone can change their own password and an
administrator can create accounts. Editing, suspending and listing accounts is not built,
and the reason is [the last administrator problem](#the-rest-of-user-management) rather
than the work.

**A live deployment.** Nothing in the application assumes it runs locally; what is missing
is a host and a managed PostgreSQL with pgvector. What that would take is under
[deploying it](#deploying-it).

**Streaming answers** are a fourth case and a design conflict rather than a shortfall. The
answer is checked against the retrieved documents before it is sent, and a citation gate
that runs after the last token cannot run halfway through the first. The chat already
streams the part that can be streamed honestly: sources appear as soon as retrieval
returns, which is seconds before the answer exists.

See [watch mode](#watch-mode) for how the self-updating pipeline decides when to run.

## Tech stack

| Layer             | Choice                                                |
| ----------------- | ----------------------------------------------------- |
| Language          | TypeScript                                            |
| Monorepo          | pnpm workspaces with TypeScript project references    |
| Web               | Next.js App Router, React                             |
| Styling           | Tailwind CSS                                          |
| Database          | PostgreSQL with the pgvector extension                |
| ORM               | Drizzle ORM                                           |
| Validation        | Zod                                                   |
| Auth              | Better Auth                                           |
| Model calls       | Vercel AI SDK                                         |
| Answer generation | Gemini 3.6 Flash by default, Claude Sonnet 5 optional |
| Embeddings        | Gemini Embedding 2, 1536 dimensions                   |
| MCP               | `@modelcontextprotocol/server`                        |

Embeddings always come from Google, because the Anthropic API has no embeddings
endpoint. Generation can use either, and the default is Google so a single key runs the
whole system. Switching to Claude Sonnet 5 is two lines in `.env`
(`GENERATION_PROVIDER=anthropic`, `GENERATION_MODEL=claude-sonnet-5`), and what it gives
up is in [docs/evaluation.md](docs/evaluation.md#which-model-writes-the-answers).

## Prerequisites

| Requirement                    | Notes                                          |
| ------------------------------ | ---------------------------------------------- |
| Node.js 20 or newer            | Built on 24.10                                 |
| pnpm 11                        | `corepack enable pnpm && corepack use pnpm@11` |
| Docker                         | Runs PostgreSQL with pgvector                  |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Embeddings, and answer generation by default   |
| `ANTHROPIC_API_KEY`            | Only if you switch generation to Anthropic     |

A Google AI Studio key is free and takes about two minutes to create at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey). With the default
settings that single key is all the project needs. Indexing the whole sample collection
costs a fraction of a cent and a question costs well under one, so running this locally
is effectively free.

## Setup

```bash
# 1. Install dependencies. The lockfile is committed, so this installs the versions
#    this project was built and measured against.
pnpm install --frozen-lockfile

# 2. Compile the workspace packages. The command line tools below import their built
#    output, so this has to happen once before any of them runs.
pnpm build:packages

# 3. Configure the environment
cp .env.example .env
# then fill in BETTER_AUTH_SECRET and GOOGLE_GENERATIVE_AI_API_KEY

# 4. Confirm the configuration is valid before going further
pnpm check:env

# 5. Start the database
docker compose up -d

# 6. Create the tables
pnpm db:migrate

# 7. Create the demo accounts
pnpm db:seed

# 8. Index the documents
pnpm ingest --write

# 9. Start the app on http://localhost:3000
pnpm dev
```

`pnpm check:env` prints the resolved settings and fails on anything missing or out of
range, reporting secrets as present or absent rather than printing them. Running it first
turns a misconfigured `.env` into a readable error instead of a failure halfway through
indexing.

Indexing the 131 sample documents took 77 seconds here, almost all of it waiting on the
embedding API. Running it again takes under a second, because nothing changed and nothing
reaches a model.

Three things worth knowing:

- The container enables the pgvector extension on first start, so there is no manual
  `CREATE EXTENSION` step. That script runs only on an empty data directory;
  `docker compose down -v` gets the first start back.
- The database credentials live in `docker-compose.yml` and in `DATABASE_URL`, and
  nothing checks that they agree. They match as shipped. Change one and change the other.
- Seeding is safe to repeat. It skips accounts that already exist.

### On Windows

The nine steps are the same. Two things around them are not:

- Docker Desktop uses the WSL 2 backend and has to be running before step 5. Everything
  else in the list waits on it, so a stopped daemon shows up as a connection error in
  `pnpm db:migrate` rather than where the problem is.
- Step 3 copies a file. `cp` is an alias for `Copy-Item` in PowerShell and is a real
  command in Git Bash, so it works in both. In `cmd.exe` use `copy .env.example .env`.

`pnpm verify:http` is the only command that needs a Unix shell, since it is a shell
script. Git for Windows provides `bash`. Nothing in setup depends on it.

I have not run any of this on Windows. The two notes come from reading the commands, not
from a machine, so treat them as a starting point rather than a tested path. Under WSL 2
the Unix instructions apply unchanged, which is the route I would take.

### What runs, and where

There is no separate backend server to start. The API lives in the same Next.js
application as the pages, as route handlers under `apps/web/app/api`, so frontend and
backend share a process, a build and a set of types. PostgreSQL runs in Docker and is not
started by this repository.

The MCP server is a second process only because stdio is the one transport a desktop MCP
client can launch itself, and an MCP client starts it. The same capability is served over
HTTP from inside the web application, so seeing it work needs nothing extra.

## Conversations

Every question and its answer are stored against a conversation, listed newest first beside
the chat. Selecting one reopens it with its answers, citations and source cards as they were
given, rather than asking the model again: re-answering would quietly rewrite your history
every time the corpus changed.

This is persistence and not continuity. A follow-up question is still answered from the
documents alone, with no memory of the turn before it, so "and what about Unity?" will not
work. The list is there so a question can be found again, not because the system holds a
conversation in its head.

A conversation belongs to the account that created it. That is enforced in the query, not
beside it, so another user's conversation is not found rather than found and refused, and a
request for one gets the same answer as a request for an id that never existed.

Greetings and thank yous are answered without searching anything, in about half a second,
and marked "No documents consulted" so it is clear no source was involved. Asking the corpus
"hello" used to return "this collection does not cover that question", which is true and
absurd.

## Accounts

Both roles can change their own password from the account menu, top right. It asks for the
current password and signs out every other session for that account. There is no sign-up
form, so an administrator creates accounts from the same menu; the role is chosen there and
fixed at creation, and nothing in the application lets an account change its own role.

## Demo accounts

| Email              | Password              | Role  | Can reach                          |
| ------------------ | --------------------- | ----- | ---------------------------------- |
| `admin@etai.local` | `demo-admin-password` | admin | Everything, including `/dashboard` |
| `user@etai.local`  | `demo-user-password`  | user  | The public pages only              |

Both are created by `pnpm db:seed`. Signing in as the ordinary user and then opening
`/dashboard` is the quickest way to see the role check working: the page is never
rendered, the request is turned away first.

Those are the seeded defaults. Either account can change its own password from
**Account** in the navigation, which asks for the current password and signs out every
other session for that user. Change one and the table above stops being true for your
copy; `pnpm db:seed` will not reset it, since it skips accounts that already exist.

There is no sign-up form. Creating an account is an administrative act in this
application, so the public surface has no way to do it, which also means no visitor can
give themselves a role. Administering somebody else's account is not built, and the
reasoning is under [future work](#future-work).

## Where the rest of it is

This README is a 526 line map. Three documents under `docs/` carry the reasoning, so
somebody who wants to run the project does not have to read past it.

| Document                                     | What is in it                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| [docs/retrieval.md](docs/retrieval.md)       | Ingestion, chunking, how search combines two methods, how an answer is grounded     |
| [docs/evaluation.md](docs/evaluation.md)     | The 106 question set, what each retrieval step scored, and what is still unmeasured |
| [docs/architecture.md](docs/architecture.md) | Layout, data model, access, tests, and the decisions worth explaining               |

## API

Two endpoints, both requiring a signed-in session of either role. Everything they accept
is validated against a schema shared with the client, so the browser and the server apply
the same rules rather than two that drift apart.

### `POST /api/search`

Finds passages without generating an answer. One embedding call and two queries, so it is
much cheaper than asking a question, which is why it is separate.

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"query": "maximum artifact size on AWS", "limit": 5}'
```

| Field     | Required | Notes                                      |
| --------- | -------- | ------------------------------------------ |
| `query`   | yes      | 2 to 500 characters after trimming         |
| `limit`   | no       | 1 to 20, defaults to 8                     |
| `docType` | no       | Restricts to one kind, such as `changelog` |

Returns each passage with its document and the metadata used for ranking. The cosine
distance and the timings are included only for an administrator.

### `POST /api/ask`

Answers a question from the documents.

```bash
curl -X POST http://localhost:3000/api/ask \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"question": "Which four checks must every runner release pass?"}'
```

```json
{
  "answer": "Every release must be green on all four providers [1], ... [1]",
  "coverage": "full",
  "gap": null,
  "citations": [{ "sourceNumber": 1, "documentPath": "release-checklist.md", "quote": "..." }],
  "sources": [{ "path": "release-checklist.md", "isDeprecated": false }],
  "droppedCitations": [],
  "model": "gemini-3.6-flash"
}
```

`coverage` is one of `full`, `partial`, `not_documented` or `out_of_scope`. The last two
are refusals: empty answer, no citations, and a `gap` saying what is missing.
`droppedCitations` lists any path the model cited that it was not given, and should stay
empty. Why citations carry a number is in
[docs/retrieval.md](docs/retrieval.md#answering).

The chat page embeds each question twice, once to search and once to answer, because the
two endpoints are independent and neither assumes the other ran. That extra embedding is
the cheapest call in the system, and it is the price of keeping `/api/search` useful on
its own to an MCP client that never asks for an answer.

### Errors

Every endpoint answers with the same shape:
`{ "error": { "code": "validation_error", "message": "..." } }`

| Status | Code               | When                                          |
| ------ | ------------------ | --------------------------------------------- |
| 400    | `validation_error` | Body missing, not JSON, or outside the limits |
| 401    | `unauthorized`     | No session                                    |
| 403    | `forbidden`        | Signed in without the role the route needs    |
| 429    | `rate_limited`     | Too many attempts                             |
| 502    | `upstream_error`   | The embedding or generation provider failed   |
| 500    | `internal_error`   | Anything unexpected                           |

An unexpected failure returns that flat 500 and nothing else, because a stray error can
carry a connection string. The 502 is separate on purpose: a provider outage is not a bug
here, and a 500 would blame the wrong system and tell a caller nothing about whether
retrying helps.

An embedding outage does not reach either of them. Search runs on two indexes and only one
of them needs a model, so when embeddings are unavailable the keyword half answers alone
and the response carries `degraded: true`. That field goes to every role, unlike the
scores beside it, because it changes how much an answer is worth and a reader who is not
told cannot tell the difference. Retrieval is measurably worse this way, which is the
argument for hybrid search in the first place, and measurably worse is not unavailable.

## Commands

| Command                                 | What it does                                                |
| --------------------------------------- | ----------------------------------------------------------- |
| `pnpm check:env`                        | Validates `.env` and prints the resolved configuration      |
| `pnpm db:generate`                      | Turns a schema change into a migration file                 |
| `pnpm db:migrate`                       | Applies pending migrations                                  |
| `pnpm db:seed`                          | Creates the demo accounts, skipping any that exist          |
| `pnpm ingest`                           | Reads the corpus and reports what it found, writing nothing |
| `pnpm ingest --write`                   | Stores it, embedding only the chunks that changed           |
| `INGEST_WATCH=true pnpm ingest --write` | Stays open and reindexes when the corpus changes            |
| `pnpm eval`                             | Measures retrieval against 106 questions and reports it     |
| `pnpm eval --sweep`                     | Runs the same set at twelve settings to check the constants |
| `pnpm compare:providers`                | Runs the question set through both generation models        |
| `pnpm answers`                          | Answers nine questions and prints them, for reading         |
| `pnpm test`                             | Runs the unit and integration tests, no API key needed      |
| `pnpm test:live`                        | Runs the tests that call a model provider                   |
| `pnpm verify:http`                      | Checks the access rules against a running app               |
| `pnpm typecheck`                        | Type checks every package and the web app                   |

`pnpm ingest --write --path <folder>` indexes a different folder. It treats that folder as
the whole collection, so anything indexed from elsewhere is marked deleted.

## Watch mode

Set `INGEST_WATCH=true` and `pnpm ingest --write` stays open, reindexing when a markdown
file under `CORPUS_PATH` changes. Ctrl-C stops it. It is off unless the value is exactly
`true`, because a command that has always finished should not start hanging by accident,
and because every reindex spends money at the embedding API.

```bash
INGEST_WATCH=true pnpm ingest --write
```

The watcher decides only _when_ to run. What changed is worked out afterwards by the same
hash comparison the command line uses, so editing one file re-embeds one file and the
other 130 cost a hash each. That split is not tidiness. Watching `corpus/` and measuring
what the operating system actually reports:

| What I did                | What arrived                                                        |
| ------------------------- | ------------------------------------------------------------------- |
| Appended to one file      | 2 to 3 events, largest gap between them 443 ms                      |
| Saved twice, 40 ms apart  | 3 events, largest gap 77 ms                                         |
| Deleted a file            | 1 event, of the same type a creation gives                          |
| Switched branch, 30 files | 42 events over 1118 ms, naming only 13 of the 30 files that changed |

The last row is why nothing is built on the event names: 17 of those files changed with
no notification naming them. The 443 and 474 ms gaps are why the wait is a second rather
than the 300 ms that would have felt about right. A shorter wait splits one edit into two
runs, and two runs means paying twice for it.

Changes that arrive while a run is going are held rather than dropped, and produce exactly
one follow-up run however many arrive. Two ingestions at once would write the same rows
while each read a database the other was halfway through changing. The follow-up is
recorded as queued, so the dashboard shows "Corpus watcher, queued behind the previous
run" and two runs a second apart do not read as two separate edits.

## Connecting an MCP client

The same three tools are served two ways. Which one you use depends on the client.

| Tool              | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `search_corpus`   | Finds passages by meaning and keyword, with the metadata that says whether a document is current |
| `answer_question` | Answers from the documents with citations, or says the collection does not cover it              |
| `get_document`    | Returns one document in full, by the path a citation names                                       |

### Over HTTP, which needs nothing extra running

The transport lives inside the web application, so `pnpm dev` is the only process. It
needs a token, because the corpus is not public. A token can also be limited to the tools
it needs, and this second one can search and read but cannot spend a generation call:

```bash
pnpm mcp:token new "my editor"
pnpm mcp:token new "read only" --scope search_corpus --scope get_document
npx @modelcontextprotocol/inspector   # takes the URL and the token, installs nothing
```

The value is printed once and only its hash is stored, so copy it then. Point a client at
`http://localhost:3000/api/mcp` with `Authorization: Bearer <token>`.

The limit is applied by not registering the other tools for that token, so a restricted
client does not see them in its tool list at all. `pnpm mcp:token list` shows what exists
and when each was last used, and `pnpm mcp:token revoke <id>` stops one working from the
next request.

### Over stdio, for a desktop client

Claude Desktop starts the server itself, so it needs an absolute path to a built file
rather than a package script. Run `pnpm build` first, then add this to
`claude_desktop_config.json` with the path adjusted:

```json
{
  "mcpServers": {
    "etai": {
      "command": "node",
      "args": ["/absolute/path/to/etAI/apps/mcp-server/dist/index.js"]
    }
  }
}
```

It reads the same `.env`, finding it by walking up from the file. No token is needed: a
process a client spawns is already inside the trust boundary, and the specification says
stdio should take its credentials from the environment. Diagnostics go to stderr, and
nothing else may go to stdout, because on stdio stdout is the protocol.

## The interface

**Retrieval scores and timings are shown to administrators only**, and the cut is made on
the server, because a field sent to the browser and hidden with CSS has still been
disclosed. The reasoning, along with how citation marks are checked rather than trusted,
is in [Decisions in the interface](docs/architecture.md#decisions-in-the-interface).

The document list at `/dashboard/documents` was built from the vocabulary the dashboard
already used, because there was no screen drawn for it. Reusing the words a reader
had already learned seemed better than inventing a second set for the same ideas.

## Future work

Two optional items are not built and one is half built. None of the three is a gap I ran
out of time to notice, so this is what exists in their place and what it does not do. The
deployment is the third not-built item and has [its own section](#deploying-it), because
what it needs is a host rather than code.

### Authorization on the MCP server

The specification wants an OAuth 2.1 authorization server: protected resource metadata at
a well known URL (RFC 9728), discovery through a `WWW-Authenticate` header carrying
`resource_metadata`, resource indicators (RFC 8707) so a token issued for one server
cannot be replayed at another, and an authorization code flow with PKCE. A client then
gets its own access on the user's behalf.

What is here is a bearer token this application issues itself. It is a real design rather
than a placeholder: the value comes from `randomBytes`, only its SHA-256 hash is stored so
the database never holds a working credential, comparison is `timingSafeEqual`, and every
token can be revoked and scoped. The scope is applied by not registering the tools outside
it, so a restricted client does not see them in its tool list rather than being refused
when it calls one. That is the part I would keep.

What it does not do is delegation. There is no authorization server, so there is no
consent step, no refresh, and no expiry: a token lasts until somebody revokes it by hand.
It is bound to nothing, so it works from wherever it is copied. Giving an editor access
means handing it a credential equal to your own rather than granting it a narrower one,
and the scope that limits it is chosen by whoever mints the token, not by the user
approving the request.

### The rest of user management

The roles themselves are done and enforced in three places, none of which is the browser:
the server component behind each page, the route handler behind each API endpoint, and the
payload itself, where an admin-only field is absent from the response rather than hidden
after it arrives. The middleware redirects but deliberately does not decide; a forged cookie
gets past it and fails at the next check.

Creating accounts and changing your own password are built. What is missing is everything
after creation: changing somebody else's role, suspending an account, removing one, and
seeing the list of who exists. The `banned` column is already read when a session is
checked, so suspending is a query and a button rather than a design problem.

The piece that is a design problem is the one that stops an administrator removing their own
admin role and locking everybody out of the dashboard. That needs a rule about the last
administrator, and a rule about the last administrator needs a decision about what happens
when there is only one. I would rather ship the half that is correct than guess at that.

## Deploying it

Not deployed. This is what I would do, and which parts are already true.

It is one Next.js process and one PostgreSQL database with pgvector, so a deployment is
those two plus environment variables. Any host that runs Next.js works, and the database
goes to a managed PostgreSQL offering pgvector; `DATABASE_URL` is the only line that
changes.

- **Migrations run as their own step, before the app starts.** `pnpm db:migrate` is a
  separate command on purpose. Running migrations from inside a server that may start
  several instances at once is how two of them try to alter the same enum.
- **The vector index is not free to rebuild.** Building HNSW over a larger corpus takes
  real time, so recreating the database on every release pays for it on every release.
- **Nothing is readable without signing in.** Already true rather than something to add:
  no sign-up form, the corpus only reachable through authenticated endpoints, and the only
  public pages are the landing page and the sign-in form.

The one thing a deployment needs that local running does not is a health check reporting
whether the index is present and how many documents carry an embedding. That query is
already written, behind the dashboard's index health panel.
