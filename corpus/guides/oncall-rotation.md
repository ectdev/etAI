# On call rotation

## Shape

One person, one week, Monday 10:00 to Monday 10:00. Eleven engineers, so a shift comes
round roughly every eleven weeks.

New engineers observe for their first month and take a shadow shift in week two of
onboarding. Nobody takes a real shift in their first month.

## What on call covers

Severity 1 at any hour. Severity 2 during working hours. Nothing else.

Explicitly not covered: customer questions, migration work, and release shepherding. Those
have owners and the on call engineer is not a fallback for them. This was written down
after the rotation quietly became a general interrupt queue.

## Handover

Ten minutes on Monday morning, in the incident channel, in writing. What fired, what was
deferred, what is still open. A verbal handover leaves the next person with no record of
what the previous week already decided not to do.

## Compensation

A shift is compensated whether or not anything fires. Paying only for pages rewards a rota
where somebody is awake and unpaid, and it makes the quiet weeks feel like the reward for
having a broken product.
