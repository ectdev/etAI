# Northlight Media

Sector: publishing. Tier: Starter. Repositories in scope: 3.

## Where they are coming from

Northlight Media runs Jenkins today. The reason they are moving is a Jenkins controller nobody was willing to upgrade. Their longest
pipeline currently takes 24 minutes, and that number is the one they will judge us on.

## Target

Primary target provider is `gcp`, chosen against the limits in that provider's
runner specification rather than by preference. The migration does not change what their
pipelines do; it changes where they run and how they are described.

## Constraints

Their build must stay green throughout. We move one pipeline at a time and the old system
keeps running until the last one is across.

Migrations are scoped at four weeks from kickoff to handover, with the first pipeline running green inside the first week and the remainder moved in order of how often they run.

## Handover

Customer engineering owns the account until handover, after which questions go to the shared support channel. The deployment reports for this account are the written record of what was
moved and what it cost.
