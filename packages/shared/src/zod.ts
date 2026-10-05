import { z } from 'zod';

/**
 * Zod, configured once, for every schema in this package.
 *
 * Zod 4 speeds up object parsing by compiling a validator with `new Function`, and finds
 * out whether it may by calling `Function("")` once. The page policy forbids `eval`, so
 * in the browser that probe fails, the failure is caught, and Zod falls back to the plain
 * parser. The catch does not stop the browser from reporting a `script-src` violation on
 * every page, though, and a policy whose reports are always noisy is one nobody reads.
 * Turning the compiler off means the probe never runs.
 *
 * The setting is read when a schema is built, not when it parses, so it has to be in
 * place before any `z.object()` runs. Importing `z` from here rather than from `zod`
 * guarantees that, because this module finishes evaluating before any module importing
 * it starts. The schemas here are small and parsed a handful of times per request, so
 * the compiled path was not buying anything measurable on the server either.
 */
z.config({ jitless: true });

export { z };
