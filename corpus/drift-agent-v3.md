# drift agent v3 (current)

The agent that runs inside a job and reports what happened back to the control plane. This
is the version to use for anything new.

It supersedes v2, which was retired in March 2026. Pipelines still on v2 keep working and
are not being forced off, but nothing new is being added there.

## Installing

```
npm install @halcyon/drift@3
```

## Starting the agent

```js
import { start } from '@halcyon/drift';

const agent = await start({ token: process.env.HALCYON_TOKEN });
```

`start()` returns a handle rather than mutating a module level singleton, so two agents can
exist in one process. That matters for the matrix runner, which is a single process
supervising several legs.

Registration is lazy. `start()` resolves as soon as the handle exists and the first `emit`
carries the registration, so a job that never reports anything never pays for a round trip.

## Reporting steps

```js
await agent.emit('build', { status: 'ok', durationMs: 4210 });
```

`emit()` awaits delivery and resolves once the control plane has the step. It replaces
`report()` from v2, which returned immediately and lost the last steps of a fast job. If
delivery fails it retries three times with backoff and then throws, so a lost step is an
error the job can see rather than a gap somebody notices a week later.

## Scoped tokens

`start()` accepts `scope` and will refuse a token that is broader than the scope asked for.

```js
const agent = await start({ token: process.env.HALCYON_TOKEN, scope: ['steps:write'] });
```

This is what the secrets policy means by least privilege in a job, and it is the part of
v3 that has no equivalent in v2 at all.

## Known limits

The agent buffers at most 200 pending steps. Beyond that `emit()` applies backpressure and
resolves slowly rather than dropping, which is the correct trade for a reporting path and
is worth knowing when a job emits a step per test case.
