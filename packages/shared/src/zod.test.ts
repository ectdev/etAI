import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The schemas never ask the browser for `eval`.
 *
 * The page policy forbids it, and Zod's compiled parser asks by calling `Function("")`.
 * Each case loads the schemas into a fresh module graph, so Zod's cached answer to that
 * question starts empty, and watches the global `Function` while they are built and used.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function watchFunction() {
  const calls: unknown[][] = [];
  const Original = globalThis.Function;
  const spy = new Proxy(Original, {
    apply(target, self, args: unknown[]) {
      calls.push(args);
      return Reflect.apply(target, self, args);
    },
    construct(target, args: unknown[]) {
      calls.push(args);
      return Reflect.construct(target, args);
    },
  });
  vi.stubGlobal('Function', spy);
  return calls;
}

describe('the configured Zod', () => {
  it('builds and parses every schema without compiling code', async () => {
    vi.resetModules();
    const calls = watchFunction();
    const shared = await import('./index.js');

    expect(shared.signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(shared.signInSchema.safeParse({ email: 'not an email', password: '' }).success).toBe(
      false,
    );
    expect(shared.signInSchema.safeParse(null).success).toBe(false);
    expect(shared.citationSchema.safeParse({}).success).toBe(false);

    expect(calls).toEqual([]);
  });

  it('is configured before the first schema exists', async () => {
    vi.resetModules();
    const { z } = await import('./zod.js');

    expect(z.config().jitless).toBe(true);
  });

  it('would have compiled without the setting, so the first case means something', async () => {
    vi.resetModules();
    const calls = watchFunction();
    const { z } = await import('zod');
    z.config({ jitless: false });

    const schema = z.object({ name: z.string() });
    expect(schema.parse({ name: 'x' })).toEqual({ name: 'x' });

    expect(calls.length).toBeGreaterThan(0);
  });
});
