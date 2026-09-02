# Pipeline configuration schema

Every pipeline is described by a `pipeline.yaml` at the repository root. This document
describes schema version 2, which is the only version the platform accepts.

Schema version 1 was removed in the 5.0 runner release. A file without a `version` key is
rejected with an error naming this document rather than being read as v1, because guessing
was worse than refusing: a v1 file read as v2 silently ignored its `steps` block and
reported a green pipeline that had run nothing.

## Minimum file

```yaml
version: 2
target: aws
jobs:
  test:
    size: medium
    steps:
      - run: npm ci
      - run: npm test
```

## Keys

`version` is required and must be `2`.

`target` is required and is one of `aws`, `gcp`, `hetzner`, `fly`. It sets which runner
specification applies, and the limits in that document are enforced rather than advisory.

`jobs` is a map of job name to definition. A job needs `size` and `steps`.

`size` is one of `small`, `medium`, `large`, `gpu-small`. Not every size exists on every
provider, and asking for one that does not is a validation failure before the job starts.

`steps` is a list. Each entry is either `run` with a shell command, or `uses` with a
published action reference.

`cache` is optional and takes a list of paths. See the build cache document for what it
costs on each provider.

`needs` is optional and takes a list of job names this job waits for. Cycles are rejected
at validation.

## Limits

The file itself may not exceed 512 KB on any provider. A pipeline may define at most 60
jobs. Both limits are checked before anything is scheduled.

## What is not in the schema

There is no `if` key and no expression language. Conditional execution is done inside a
step, in the shell, where it can be read and tested. This has been asked for repeatedly and
the answer has stayed the same: a config language that can branch is a programming language
without a debugger.
