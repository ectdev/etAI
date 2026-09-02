# The build cache, and why it is a separate layer

The cache is not part of the artifact store and does not share its limits. That separation
is deliberate and it is the thing most often misunderstood during a migration.

## Why they are separate

An artifact is an output somebody asked for and expects to still exist. A cache entry is a
performance optimisation that must be safe to lose at any moment. Storing them together
would mean either treating cache entries as durable, which is expensive, or treating
artifacts as disposable, which is wrong.

Keeping them apart also means the cache can be evicted under pressure without a customer
losing a build output, and it means a corrupted cache is fixed by deleting it rather than
by a support ticket.

## How it is keyed

A cache entry is keyed by the pipeline id, the job name, and a hash of the files named in
the `cache` block. Changing any of the three produces a miss rather than a stale hit. There
is no cross job cache sharing except on AWS, where the Docker layer store is shared per
customer, which is documented in that provider's specification.

## Retention

Retention is counted from the last read, not from the write, so a cache that is used stays
alive. The window differs per provider: 7 days on Fly, 14 on AWS and GCP, 30 on Hetzner.

## When the cache costs more than it saves

On Fly there is no warm pool, so every run fetches the cache over the network before the
first step. For a dependency cache above roughly 400 MB this regularly costs more time than
reinstalling from a registry, and the fix is to remove the `cache` block rather than to
tune it. The 400 MB figure comes from timing eleven customer pipelines during migrations
and is a guide rather than a threshold the platform enforces.

On the other three providers there is a warm pool and this trade does not turn over at any
size we have observed.
