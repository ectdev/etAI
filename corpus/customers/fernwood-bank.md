# Fernwood Bank

Sector: banking. Tier: Scale. Repositories in scope: 18.

## Where they are coming from

Fernwood Bank runs Jenkins today. The reason they are moving is an audit trail requirement on every build machine. Their longest
pipeline currently takes 47 minutes, and that number is the one they will judge us on.

## Target

Primary target provider is `hetzner`, chosen against the limits in that provider's
runner specification rather than by preference. The migration does not change what their
pipelines do; it changes where they run and how they are described.

They also run part of their estate on Azure and have asked whether we can target it. We cannot today. The four providers we support are listed in the platform overview and Azure is not among them, so anything running there stays where it is for now.

## Constraints

Their build must stay green throughout. We move one pipeline at a time and the old system
keeps running until the last one is across.

Migrations are scoped at four weeks from kickoff to handover, with the first pipeline running green inside the first week and the remainder moved in order of how often they run.

## Handover

Customer engineering owns the account until handover, after which questions go to the shared support channel. The deployment reports for this account are the written record of what was
moved and what it cost.
