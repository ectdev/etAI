# drift agent v2 (DEPRECATED)

Status: deprecated since March 2026. Kept here because pipelines still running it need
somewhere to read, and because the migration notes below are the only written record of
what changed.

Do not start new work against this version. The current agent is v3.

## Installing

```
npm install @halcyon/drift@2
```

## Starting the agent

v2 is initialised once per job, and the call blocks until the agent has registered with
the control plane.

```js
const drift = require('@halcyon/drift');
drift.init({ token: process.env.HALCYON_TOKEN });
```

`init()` accepts a `timeout` in milliseconds and defaults to 30000. On timeout it throws
rather than retrying, which is the behaviour that produced most of the flaky job reports
in early 2026.

## Reporting steps

```js
drift.report('build', { status: 'ok', durationMs: 4210 });
```

`report()` sends one step result. It is fire and forget: the call returns immediately and
the agent flushes on an interval. If the job exits before a flush, the last steps are lost,
which is why v2 jobs sometimes show a pipeline as green with a missing final step.

## Why it was retired

Three reasons, in the order they mattered.

The fire and forget reporting lost data on fast jobs, and the fix required changing the
call signature, so it could not be done in place.

`init()` blocking meant every job paid the registration cost serially even when the agent
was not needed until later.

The token was read from a single environment variable with no way to scope it per step,
which the secrets policy now forbids.

## Migrating

The v3 agent is not a drop in replacement. `init()` became `start()` and returns a handle
rather than mutating a module singleton, and `report()` was removed entirely: the
equivalent is `emit()`, which awaits delivery. See the v3 document for the current calls.
