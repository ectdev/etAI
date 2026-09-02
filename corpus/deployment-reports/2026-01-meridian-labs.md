# Meridian Labs, 2026-01

Status: migration in progress. The old system is still running and will be switched off at handover.

## Moved this month

5 of 7 repositories are now running on Halcyon, targeting `hetzner`.

## Timings

The pipeline the customer measures us on ran in 148 minutes on the old system and
runs in 93 minutes here. Both numbers are the median of the month rather than a best
case, because a best case is not what anybody waits for.

Cache retention is counted from the last read, so a pipeline that runs daily keeps its cache warm.

## What came up

Artifact size measured after extraction rather than compressed, which moved one job from passing to failing before the first run rather than after it.

## Review

Reviewed on the Thursday of the closing week by the customer engineering lead and one platform engineer who did not run the migration.
