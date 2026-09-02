import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * That the reduced motion preference is honoured.
 *
 * This is the kind of rule that gets written once, believed forever, and never checked,
 * because the only way to see it working is to change a system setting and reload. It
 * costs nothing to assert and it protects a real person: somebody who has asked their
 * operating system for less motion has asked for none.
 *
 * The check is on the stylesheet rather than on a rendered page, because the rule is a
 * media query and a browser is not needed to know whether one is written.
 */

const CSS = readFileSync(new URL('../apps/web/app/globals.css', import.meta.url), 'utf8');

describe('motion', () => {
  it('turns animation off under prefers-reduced-motion', () => {
    expect(CSS).toContain('prefers-reduced-motion: reduce');

    // The block has to reach everything rather than one class, since the animations are
    // spread across the chat surface, the dashboard skeletons and the landing screen.
    const block = CSS.slice(CSS.indexOf('prefers-reduced-motion: reduce'));

    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it('has something to turn off, so the rule above is not guarding an empty set', () => {
    /**
     * The premise. A stylesheet with no animation satisfies the first test perfectly and
     * proves nothing, and this file would keep passing after somebody removed every
     * keyframe in the project.
     */
    const keyframes = CSS.match(/@keyframes\s+[\w-]+/g) ?? [];

    expect(keyframes.length).toBeGreaterThan(2);
    expect(CSS).toContain('@keyframes et-rise');
  });

  it('reaches the disclosure transition, because the selector is universal', () => {
    /**
     * The landing references fold open on a transition rather than an animation, and the
     * reduced motion block was written before that existed. Asked whether it covers the
     * new thing, the honest answer is not "it should" but "the selector is `*` and the
     * declaration is `!important`, so nothing can escape it". That is checkable.
     *
     * A block that listed class names instead would have been silently outgrown here.
     */
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);

    // And there has to be a transition for it to turn off, or the rule above is decoration.
    // Matched on the property with any duration rather than on the duration itself: what
    // this test is about is that something is transitioned, and pinning the number here
    // means a timing change fails a test about reduced motion.
    expect(CSS).toMatch(/grid-template-rows \d[\d.]*s/);
    expect(CSS).toMatch(/transition: transform \d[\d.]*s/);
  });

  it('does not loop anything on the landing screen', () => {
    // Restraint is a decision here rather than an accident. The pulse on a skeleton row
    // loops because it marks something still loading; nothing on a settled page should.
    const start = CSS.indexOf('.et-rise {');

    // Searched from `start` rather than from the beginning of the file. Without the second
    // argument this found the first breakpoint of that width in the stylesheet, which is
    // some 700 lines above the landing rules, so the slice ran backwards and came out
    // empty. An empty string contains no 'infinite' and the assertion below passed on
    // nothing at all, which it did for as long as this test has existed.
    const end = CSS.indexOf('@media (max-width: 1180px)', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(CSS.slice(start, end)).not.toContain('infinite');
  });
});
