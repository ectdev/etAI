# Runner specification: Google Cloud

Applies to every pipeline whose target is set to `gcp` in `pipeline.yaml`. Last reviewed
2026-05-11.

## Limits

| Limit                       | Value                     |
| --------------------------- | ------------------------- |
| Maximum artifact size       | 4 GB per job, uncompressed |
| Maximum job duration        | 4 hours                   |
| Concurrent jobs, Starter    | 4                         |
| Concurrent jobs, Scale      | 20                        |
| Cache retention             | 14 days since last read   |
| Maximum pipeline definition | 512 KB                    |

The four hour job ceiling is the lowest of the four providers and is the single most
common reason a migration from AWS to GCP needs pipeline changes rather than a config
edit. Long integration suites have to be split before they will run here at all.

## Networking

Outbound access is on, inbound is off, and egress addresses come from a regional pool that
we do not pin. Customers who need an allowlisted source address are put on AWS with a NAT
gateway instead, because pinning here would mean reserving addresses per customer and the
cost lands badly at our size.

## Machine sizes

`small` is 2 vCPU and 4 GB, `medium` is 4 vCPU and 8 GB, `large` is 8 vCPU and 32 GB. Note
that `large` carries twice the memory it does on AWS, which is why a few memory hungry
build steps are pinned to this provider deliberately.

## Known differences

Artifact upload is measurably slower than on AWS for files above about 1 GB, which shows
up as job duration rather than as an error. Two migrations have been sent back to AWS over
this and both are written up in their deployment reports.
