# Halcyon runner 5.1 (2026-02-03)

## Fixed

The AWS Docker layer cache key now includes the pipeline id. Two pipelines in one account
with the same job name and an identical lockfile hash could previously collide and read
each other's layers. This is the fix for the April cache poisoning incident, and deploying
it evicted the entire AWS layer store, so the first build after this release was slow for
every AWS customer.

## Changed

Cache key derivation is now documented in the build cache document rather than living only
in the runner source.
