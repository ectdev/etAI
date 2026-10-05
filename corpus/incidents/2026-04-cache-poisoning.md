# Postmortem: cache poisoning across two pipelines, April 2026

Date: 2026-04-17. Severity 2. Customer visible for 6 hours 40 minutes.

## What happened

Two pipelines belonging to the same customer on AWS began producing builds containing the
other's dependencies. Both were green. The corruption was found by the customer, not by us,
which is the part of this that mattered most.

## Cause

The AWS runner shares a Docker layer store per customer rather than per pipeline, which is
documented and intended. The cache key for the dependency layer included the job name and
the hash of the files named in the `cache` block, but not the pipeline id.

Two pipelines in the same account had a job with the same name, `build`, and lockfiles that
hashed identically because both pinned the same dependency set. The keys collided and each
run warmed a cache the other then read.

The collision was possible from the first day of the shared layer store and required two
pipelines with the same job name in one account to make it visible. That combination did
not exist until the customer added the second pipeline.

## Detection

The customer opened a ticket saying a build contained a package their project does not
depend on. Our own monitoring showed nothing, because both pipelines were green and the
cache hit rate was normal. There was no alert to miss; there was no signal.

## Fix

The cache key now includes the pipeline id. Shipped in runner 5.1, and the entire AWS layer
store was evicted on deploy, which cost every AWS customer one slow build.

## What we changed beyond the fix

The cache key derivation is now written down in the build cache document rather than living
only in the code, because the missing component was obvious once stated and had never been
stated.

We did not add per pipeline layer stores. Sharing per customer is what makes the warm cache
valuable on AWS, and the fix removes the collision without removing the benefit.

## What we did not fix

There is still no detection for a cache serving the wrong content. We considered content
hashing on read and turned it down: it costs a hash of the full layer on every hit to catch
a class of bug the key derivation should prevent. If a second incident of this shape
happens, that decision is the one to revisit.
