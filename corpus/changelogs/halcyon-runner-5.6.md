# Halcyon runner 5.6 (2026-05-12)

## Changed

Artifact size is now checked continuously during a job rather than only at the end. A job
that will exceed the provider limit is stopped when it crosses it, with the step and the
path named.

The previous behaviour checked at upload, which meant a six hour job could run to
completion and then fail on a limit it had crossed in the first ten minutes.

## Fixed

Queue duration in `pipeline.started` was measured from acceptance rather than from the
first job leaving the queue, and was therefore too large by the validation time.
