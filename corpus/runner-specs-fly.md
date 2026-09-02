# Runner specification: Fly

Applies to every pipeline whose target is set to `fly` in `pipeline.yaml`. Last reviewed
2026-05-11.

## Limits

| Limit                       | Value                      |
| --------------------------- | -------------------------- |
| Maximum artifact size       | 2 GB per job, uncompressed |
| Maximum job duration        | 1 hour                     |
| Concurrent jobs, Starter    | 8                          |
| Concurrent jobs, Scale      | 40                         |
| Cache retention             | 7 days since last read     |
| Maximum pipeline definition | 512 KB                     |

The tightest artifact and duration limits and by far the widest concurrency. This provider
exists for short wide work: linting, unit tests, preview builds. Anything that needs to run
for an hour is in the wrong place.

## Networking

Outbound on, inbound off, no static egress under any tier. There is no request path for
one; customers who need it move to Hetzner.

## Machine sizes

`small` is 1 vCPU and 2 GB, `medium` is 2 vCPU and 4 GB. There is no `large` and no GPU. A
pipeline that asks for `large` on this provider fails validation before it starts, which
is the correct moment, and the error names the two sizes that exist.

## Known differences

Machines here are ephemeral in a stronger sense than on the other providers: there is no
warm pool at all, and the cache is fetched over the network on every run. For a pipeline
with a large dependency cache that can cost more than the job saves, and the build cache
document explains when that trade turns over.
