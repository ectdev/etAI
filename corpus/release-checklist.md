# Release checklist

Every runner release passes this list before it ships. The list is short on purpose: a
checklist nobody finishes is a checklist nobody reads.

## The four checks every release must pass

Every release, without exception, has to clear all four of these:

1. **Green on all four providers.** The integration suite runs against AWS, GCP, Hetzner
   and Fly. A release that is green on three and untested on the fourth does not ship, and
   this has delayed two releases.
2. **Schema compatibility.** Any `pipeline.yaml` valid before the release is still valid
   after it, or the release carries a migration note naming exactly what changed.
3. **Rollback rehearsed.** The previous runner version is started from the release
   candidate's own artifacts, not from a stale build, and a pipeline is run on it.
4. **No secret in the cache.** A scripted scan of the release's own test caches for any
   value matching a stored secret. This exists because it happened once, in the 4.8 cycle.

## Before the first run of a customer pipeline

Separate from the release list and just as easy to skip.

Check the artifact size after extraction rather than compressed. The limit is enforced on
the extracted size and it is checked at the end of the job, so getting this wrong costs a
whole run.

Check that the requested machine size exists on the target provider. `large` does not
exist on Fly and `gpu-small` exists only on Hetzner.

Check the job duration against the provider ceiling. Four hours on GCP is the lowest and is
the most common cause of a migration needing pipeline changes.

## What is deliberately not on this list

Performance regression testing. We have no reliable baseline across four providers with
different machine shapes, so a number here would be theatre. The deployment reports carry
observed timings instead, which is weaker and honest.
