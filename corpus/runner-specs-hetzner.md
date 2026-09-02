# Runner specification: Hetzner

Applies to every pipeline whose target is set to `hetzner` in `pipeline.yaml`. Last
reviewed 2026-05-11.

## Limits

| Limit                       | Value                      |
| --------------------------- | -------------------------- |
| Maximum artifact size       | 8 GB per job, uncompressed |
| Maximum job duration        | 12 hours                   |
| Concurrent jobs, Starter    | 2                          |
| Concurrent jobs, Scale      | 12                         |
| Cache retention             | 30 days since last read    |
| Maximum pipeline definition | 512 KB                     |

The most generous artifact and duration limits of the four, and the tightest concurrency.
That combination is deliberate: this is where long single jobs go, not where wide fan out
goes. A matrix build with thirty legs will queue here and will not on AWS.

## Networking

Outbound on, inbound off, and a static egress address per customer at no extra cost. This
is the only provider where an allowlisted source address is included rather than requested,
and it is the reason several finance and health customers are here rather than on AWS.

## Machine sizes

`small` is 2 vCPU and 8 GB, `medium` is 8 vCPU and 16 GB, `large` is 16 vCPU and 32 GB.
GPU machines are available in the `gpu-small` size, 1 GPU with 8 vCPU and 32 GB, and they
are the only GPUs anywhere on the platform.

## Known differences

Provisioning a new machine takes noticeably longer here, around 40 to 70 seconds against
under 15 on AWS. For pipelines that run constantly this disappears into the warm pool. For
a pipeline that runs twice a day it is most of the perceived wait.
