# Halcyon runner 5.3 (2026-03-10)

## Reverted

**Cache retention is counted from the last read again**, undoing the change made in 5.2.

Counting from the write looked correct on the storage bill and was wrong in practice. A
pipeline that runs every day on a stable dependency set lost its cache on a fixed schedule
regardless of how well it was working, and the rebuild cost more across all customers than
the storage saved. Three customers reported it as a regression in the first week.

The retention windows are unchanged and remain 7 days on Fly, 14 on AWS and GCP, 30 on
Hetzner, now counted from last read as they were before 5.2.

The `cache.evicted` event added in 5.2 stays. It turned out to be useful independently.
