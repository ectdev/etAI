# Onboarding, first two weeks

What a new engineer does before touching the runner. Written for the person joining, not
for whoever is onboarding them.

## Day one

Get a laptop, get on the VPN, get added to the on call calendar as an observer. Nobody
takes a shift in the first month.

Read the company overview, then the four runner specification documents in one sitting.
They are boring and they are the whole product. Most of the confusion in the first month
comes from assuming the four providers behave alike.

## Week one

Run the platform locally. It comes up with Docker and a single command, and the README is
kept current in the same commit as the code that changes it, so if it does not work say so
the same day rather than working around it.

Pick up two issues labelled `first-week`. They are real and small and both touch the config
validator, which is the safest place to be wrong.

Sit in on one customer migration call. Do not speak. The gap between how we describe the
platform and how a customer describes their pipeline is the most useful thing to see early.

## Week two

Write a deployment report for a migration you did not run. Somebody else's notes, your
words. It is the fastest way to learn the shape of the product and it is genuinely useful
output, because the engineer who ran it is usually three customers further along.

Take one on call shadow shift.

## What nobody tells you

The runner release cadence is roughly three weeks and it is not a schedule, it is an
average. Releases wait on the four provider integration suite and Hetzner is the one that
usually holds it up, for the provisioning latency reason in its specification.

Ask about anything in a public channel. There is no private engineering channel and that is
on purpose.
