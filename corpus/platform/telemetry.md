# Analytics events

What the platform records about a pipeline run, and what it deliberately does not.

## Events

| Event              | When                                   | Carries                            |
| ------------------ | -------------------------------------- | ---------------------------------- |
| `pipeline.queued`  | A run is accepted                      | pipeline id, target, trigger       |
| `pipeline.started` | The first job leaves the queue         | queue duration                     |
| `job.started`      | A job is scheduled onto a machine      | job name, size, provider           |
| `job.finished`     | A job ends for any reason              | status, duration, exit code        |
| `step.emitted`     | The agent reports a step               | step name, status, duration        |
| `cache.hit`        | A cache key resolves                   | key hash, bytes, fetch duration    |
| `cache.miss`       | A cache key does not resolve           | key hash                           |
| `pipeline.finished`| Every job has ended                    | status, total duration, job count  |

## Naming

Events are `noun.verb_past`, lowercase, dot separated. The noun is the thing the event is
about and never the actor. `job.started` rather than `runner.started_job`, because every
query we have written groups by the thing rather than by who touched it.

## What is not recorded

We do not record step output, environment variables, or file names inside a job. The
argument comes up every few months because it would make debugging easier, and the answer
has stayed no: the moment output is recorded, secrets are recorded, and masking is best
effort rather than a control.

We do not record source code, commit messages, or branch names beyond a hash. A branch name
is customer information and carries product plans surprisingly often.

## Retention

Events are kept for 90 days at full detail and rolled into daily aggregates after that. The
aggregates keep counts and durations and drop the identifiers, so a question about last
March can be answered in shape but not in specifics.
