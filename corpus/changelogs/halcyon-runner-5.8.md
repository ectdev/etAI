# Halcyon runner 5.8 (2026-06-23)

## Added

`--dry-run` on the CLI, which validates a `pipeline.yaml` and prints the job graph without
scheduling anything. It reads the same validator the platform runs, so a file that passes
here passes there.

## Fixed

A pipeline with 60 jobs, which is the documented maximum, was rejected as exceeding the
maximum. The check used greater than or equal rather than greater than.
