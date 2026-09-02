# Halcyon runner 5.0 (2026-01-14)

A breaking release. Read the schema note before upgrading.

## Removed

Schema version 1 is no longer accepted. A `pipeline.yaml` without a `version` key is now
rejected with an error naming the schema document, rather than being read as v1. The old
behaviour silently ignored a v2 `steps` block and reported a green pipeline that had run
nothing, which is the worst failure shape available.

## Added

`needs` on a job, taking a list of job names to wait for. Cycles are rejected at
validation rather than at run time.

## Changed

Validation errors now name the key and the line. Previously they named the file.
