# Corvid Analytics, 2026-02

Status: migration in progress. The old system is still running and will be switched off at handover.

## Moved this month

5 of 21 repositories are now running on Halcyon, targeting `fly`.

## Timings

The pipeline the customer measures us on ran in 120 minutes on the old system and
runs in 56 minutes here. Both numbers are the median of the month rather than a best
case, because a best case is not what anybody waits for.

Cache retention is counted from the last read, so a pipeline that runs daily keeps its cache warm.

## What came up

One job asked for a machine size that does not exist on the target provider. Caught at validation, which is the cheap moment.

## Review

Reviewed on the Thursday of the closing week by the customer engineering lead and one platform engineer who did not run the migration.
