# Naming conventions

One page, because a convention nobody can recall is a convention nobody follows.

## Pipelines

`<repo>-<purpose>`, lowercase, hyphen separated. `checkout-api-test`, `checkout-api-release`.
The repository name comes first because every list we show is grouped by repository.

## Jobs

A verb or a noun, not both, and never a sentence. `test`, `build`, `publish`, `lint`.

Job names have to be unique inside a pipeline and are not required to be unique across
pipelines. That was fine until the April cache incident, where two pipelines in one account
both had a job called `build` and the cache key did not include the pipeline id. The key
was fixed rather than the convention, because a global uniqueness rule on job names would
be unenforceable and would have hidden the real bug.

## Cache keys

Do not write cache keys. They are derived from the pipeline id, the job name and a hash of
the files named in the `cache` block. There is no way to set one and there will not be one.

## Secrets

`SCREAMING_SNAKE_CASE`, prefixed by what they open. `DEPLOY_KEY`, `NPM_TOKEN`,
`SENTRY_AUTH_TOKEN`. The prefix matters because the per step `secrets` list is read by
people deciding whether a step should have it.

## Branches

We do not enforce a branch convention and do not read branch names beyond a hash. See the
analytics document for why: a branch name is customer information and carries product
plans more often than anyone expects.
