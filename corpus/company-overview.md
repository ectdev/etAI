# Halcyon

Halcyon builds and runs continuous integration pipelines for teams that have outgrown
whatever their code host gave them for free. We are a platform company: customers describe
a pipeline, we run it on machines they do not have to think about, and we are responsible
for the part between a push and a green check.

## Where we are

The company is based in Istanbul, with eleven engineers and three people in customer
engineering. Everyone works in the same timezone on purpose, because the on-call rotation
is small enough that a follow-the-sun split would leave one person awake alone.

## What we run

Roughly 90,000 pipeline runs a month across all customers, with the busiest single hour of
the week falling on Tuesday afternoons. About two thirds of those runs are on the Scale
tier and the rest on Starter.

We run on four cloud providers, and which one a pipeline lands on is a customer setting
rather than something we decide: AWS, Google Cloud, Hetzner and Fly. Each has its own
limits on artifact size, job duration and concurrency, and those differences are real
enough that a pipeline tuned for one can fail on another. The per provider numbers are in
the runner specification documents.

## How work arrives

Customers come to us through migrations rather than through green field projects. Somebody
has a pipeline that already works and is too slow, too expensive, or too tangled to keep.
Customer engineering runs the migration, writes it up, and hands the account over. Those
write ups are the deployment reports, one per customer per month while a migration is
active.

## What we do not do

We do not host source code, we do not run production workloads, and we do not offer a
container registry. Every one of those has been asked for and turned down for the same
reason: they are separate products wearing the same login, and doing one of them badly
would cost more trust than doing none of them.
