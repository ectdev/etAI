# Review process

## Who reviews what

Every change to the runner needs one approval from somebody who did not write it. Changes
to the config validator need two, because a validator bug reaches every customer at once
and is the only component where that is true.

Changes to the corpus of documentation need no approval and are merged by the author.
Documentation that waits on a reviewer goes stale, and stale documentation is worse than
documentation written slightly wrong by somebody who was there.

## The migration review

Before a customer migration is handed over, it is reviewed by the customer engineering lead
together with one platform engineer who did not run the migration. The review reads the
deployment report against the pipeline as it actually stands and checks the four items on
the release checklist that apply to customer pipelines.

The review happens on the Thursday of the week the migration finishes.

## What is reviewed

The deployment report, the final `pipeline.yaml`, the observed timings, and any provider
change made during the migration.

## Standing rule

A review that finds nothing is written up as a review that found nothing, with a line
saying so. An empty review record and a clean review are indistinguishable afterwards and
they mean different things.
