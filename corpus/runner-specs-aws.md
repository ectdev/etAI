# Runner specification: AWS

Applies to every pipeline whose target is set to `aws` in `pipeline.yaml`. Last reviewed
2026-05-11.

## Limits

| Limit                        | Value                                  |
| ---------------------------- | -------------------------------------- |
| Maximum artifact size        | 5 GB per job, uncompressed             |
| Maximum job duration         | 6 hours                                |
| Concurrent jobs, Starter     | 4                                      |
| Concurrent jobs, Scale       | 20                                     |
| Cache retention              | 14 days since last read                |
| Maximum pipeline definition  | 512 KB                                 |

The artifact limit is measured after extraction, not on the uploaded archive. A 900 MB
tarball that unpacks to 6 GB is rejected at the end of the job, which is the worst moment
to find out, so the release checklist asks for it to be checked before the first run.

## Networking

Jobs run with outbound internet access and no inbound. There is no static egress address
on the Starter tier. Scale customers can request a dedicated NAT gateway, which adds a
fixed monthly cost and takes about two working days to provision.

## Machine sizes

`small` is 2 vCPU and 4 GB, `medium` is 4 vCPU and 8 GB, `large` is 8 vCPU and 16 GB.
There is no GPU option on AWS. Requests for one are pointed at Hetzner, which has them.

## Known differences

Docker layer caching behaves differently here than on the other three providers, because
the AWS runner uses a shared layer store per customer rather than per pipeline. Two
pipelines in the same account can therefore warm each other's cache, which is usually
welcome and occasionally surprising when one of them is building an older base image.
