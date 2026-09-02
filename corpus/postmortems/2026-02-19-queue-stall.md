# Postmortem: queue stall on GCP, February 2026

Date: 2026-02-19. Severity 1. Customer visible for 51 minutes.

## What happened

Every GCP pipeline queued and none started. AWS, Hetzner and Fly were unaffected.

## Cause

The GCP scheduler holds a lease on a machine while it provisions and releases it when the
job starts or when provisioning fails. A provider side quota error returned a response
shape the scheduler did not recognise, so it took neither path and held the lease
indefinitely. Twelve leases accumulated over about forty minutes and exhausted the pool.

## Detection

Queue depth alert at 14 minutes. The alert threshold was a fixed depth rather than a rate,
so a slow accumulation sat under it while it grew.

## Fix

Leases now expire after twice the provisioning timeout regardless of what the scheduler
does with them. Shipped as a hotfix on the day.

## What we changed beyond the fix

The queue depth alert now fires on rate of change as well as depth.

## What we did not fix

The scheduler still parses provider errors by shape rather than by code, and the other
three providers have the same class of gap. It is written down and it is not scheduled.
