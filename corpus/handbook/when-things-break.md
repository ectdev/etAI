# Incident process

## Severities

**Severity 1.** Customer pipelines cannot run, on any provider. Page immediately.

**Severity 2.** Pipelines run and produce wrong results, or one provider is down. Page
during working hours, otherwise open at the start of the next day. The April cache
poisoning was a severity 2 and is the reference case: green pipelines, wrong output.

**Severity 3.** Degraded but correct. Slow queues, delayed telemetry. No page.

Wrong results outrank total outage in everything except reach, which is why a single
customer getting bad builds is a 2 and a slow queue for everyone is a 3.

## Roles

One incident lead, who does not fix anything. They decide severity, write the timeline as
it happens, and own communication. Anybody else is a responder.

The lead role exists because the first two incidents were run by whoever noticed, and both
times the person who understood the fault best spent half of it writing updates.

## During

Write the timeline while it happens, in the incident channel, in public. A timeline
reconstructed afterwards is a story about what people remember.

Communicate to affected customers at the point severity is set, not at the point the cause
is known. The two are usually hours apart and the customer is already looking at it.

## After

A postmortem within five working days for severity 1 and 2. No postmortem for severity 3
unless the same one happens twice.

The postmortem names what was not fixed as clearly as what was. The April one is the model:
it says plainly that there is still no detection for a cache serving wrong content and that
the decision to skip it is the one to revisit if it recurs.
