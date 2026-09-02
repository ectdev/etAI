import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every design token the stylesheet asks for is a token the stylesheet has.
 *
 * `padding: var(--space-5)` sat in two rules for a day. There is no fifth step in this
 * scale, it goes 1, 2, 3, 4, 6, 8, and CSS does not treat that as an error: an undefined
 * custom property makes the whole declaration invalid at computed-value time, so the
 * property falls back to its initial value. For padding that is zero. The landing card
 * and the signed-in panel had no padding at all and looked merely cramped, which is the
 * worst kind of wrong, because it reads as a design opinion rather than as a defect.
 *
 * Nothing catches this. The build succeeds, the file is valid CSS, prettier formats it,
 * and Tailwind has no opinion about a name it does not own. Only opening the page and
 * knowing what it should have looked like finds it.
 *
 * A fallback is a decision rather than a mistake, so `var(--x, 12px)` is allowed through.
 */

const RAW = readFileSync(new URL('../apps/web/app/globals.css', import.meta.url), 'utf8');

/**
 * Comments come out first. The note explaining the fix for `--space-5` names the token it
 * is about, and the first run of this test failed on that sentence rather than on any
 * rule. A scan that cannot tell code from the prose about the code is a scan that gets
 * turned off.
 */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Set on `<html>` by next/font in `layout.tsx`, so it never appears as a declaration in
 * this file. It is the only name that legitimately comes from outside the stylesheet, and
 * listing it by hand is the point: a second entry here should have to be argued for.
 */
const DEFINED_ELSEWHERE = new Set(['--font-inter']);

describe('design tokens', () => {
  it('defines every custom property it uses', () => {
    const defined = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const name of DEFINED_ELSEWHERE) defined.add(name);

    // A `var(--x, fallback)` is deliberate. A `var(--x)` with nothing behind it is not.
    const used = [...CSS.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]);

    expect(used.length, 'no var() calls found, so this test is checking nothing').toBeGreaterThan(
      20,
    );
    expect(
      defined.size,
      'no declarations found, so every name would look undefined',
    ).toBeGreaterThan(20);

    const missing = [...new Set(used)].filter((name) => !defined.has(name));

    expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
  });

  it('has a spacing scale with the gaps the previous test was written about', () => {
    /**
     * The premise. The bug was reaching for a step between 4 and 6 that does not exist,
     * and if somebody adds `--space-5` the first test keeps passing for a new reason.
     * That is fine and it should be a visible decision, so this fails when the shape of
     * the scale changes and asks whoever changed it to say why here.
     */
    const steps = [...CSS.matchAll(/--space-(\d+)\s*:/g)].map((match) => Number(match[1]));

    expect([...new Set(steps)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 8]);
  });
});
