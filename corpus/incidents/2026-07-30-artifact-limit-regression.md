# Postmortem: artifact limit enforced at the wrong size, July 2026

Date: 2026-07-30. Severity 2. Customer visible for 3 hours 10 minutes.

## What happened

After runner 5.9 deployed, jobs on Hetzner began failing the artifact size check at around
5 GB rather than the documented 8 GB. Four customers hit it.

## Cause

The continuous artifact check added in 5.6 read the limit from a per provider table. A
refactor in 5.9 moved the table and the Hetzner entry was left with the AWS value. Nothing
failed, because 5 GB is a valid limit; it was simply the wrong one.

No test covered the per provider values. The tests covered that a limit is enforced and
that crossing it stops the job, both of which stayed true.

## Detection

Customer report, then a second within eleven minutes.

## Fix

Corrected the table and shipped as 5.9.1. The four affected jobs were rerun for the
customers at no charge.

## What we changed beyond the fix

There is now a test that reads the four documented limits out of the runner specification
documents and asserts the table matches them. It fails if either side is edited alone,
which is the property that was missing: two sources for one number with nothing comparing
them.

## What we did not fix

The other per provider tables, machine sizes and cache retention among them, have the same
shape and no such test. Named here rather than fixed, because the pattern is worth one test
per table and that work is not scheduled.
