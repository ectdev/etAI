# Halcyon runner 5.2 (2026-02-24)

## Changed

**Cache retention is now counted from the write rather than from the last read.** An entry
expires a fixed period after it was created, whichever way it has been used since.

The argument for this was cost. Counting from last read means a cache that is read daily
never expires, and a handful of large entries had been alive for months. Counting from
write puts a ceiling on how long any entry can live.

The retention windows themselves are unchanged: 7 days on Fly, 14 on AWS and GCP, 30 on
Hetzner.

## Added

`cache.evicted` analytics event, carrying the key hash and the reason.
