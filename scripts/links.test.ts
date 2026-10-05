import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every relative link in the repository's Markdown, resolved against the file it is in.
 *
 * GitHub resolves a link from the directory of the file that holds it, so a path that
 * reads fine from the root breaks the moment the file lives in `docs/`. The manual testing
 * guide had forty of those, written from the root and broken from the day they were
 * written, and nothing complained because a broken link is only noticed by a reader.
 *
 * Links into the web, mail addresses and same-page anchors are not checked here. The
 * fragment of a file link is dropped before the check: the file has to exist, the heading
 * is the reader's problem.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** `[text](target)` and `![alt](target)`, with an optional title after the target. */
const INLINE = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** `[label]: target` on a line of its own. */
const REFERENCE = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm;

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Fenced blocks and inline code are examples, not links, so they come out first. */
function withoutCode(markdown: string): string {
  return markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

export function relativeTargets(markdown: string): string[] {
  const text = withoutCode(markdown);
  const targets = [...text.matchAll(INLINE), ...text.matchAll(REFERENCE)].map((match) => match[1]!);
  return targets.filter((target) => !EXTERNAL.test(target));
}

export function brokenLinks(
  path: string,
  markdown: string,
  exists: (path: string) => boolean,
): string[] {
  return relativeTargets(markdown).flatMap((target) => {
    const file = decodeURIComponent(target.split('#')[0]!);
    if (file.length === 0) return [];
    const resolved = normalize(join(dirname(path), file));
    return exists(resolved) ? [] : [`${path}: ${target}`];
  });
}

function markdownFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => path.length > 0 && !path.startsWith('corpus/'));
}

describe('links', () => {
  it('resolves every relative link in the documentation', () => {
    const broken = markdownFiles().flatMap((path) =>
      brokenLinks(path, readFileSync(join(ROOT, path), 'utf8'), (target) =>
        existsSync(join(ROOT, target)),
      ),
    );

    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('checks the links it should and leaves the rest alone', () => {
    const onDisk = new Set([
      'docs/retrieval.md',
      'apps/web/proxy.ts',
      'README.md',
      'docs/images/chat.png',
    ]);
    const exists = (path: string) => onDisk.has(path);
    const page = [
      '[fine](retrieval.md) and [also fine](../apps/web/proxy.ts#L10)',
      '[written from the root](apps/web/proxy.ts)',
      '![picture](images/chat.png "a title")',
      '[web](https://example.com) [mail](mailto:a@b.c) [anchor](#setup)',
      '`[not a link](nowhere.md)`',
      '```md',
      '[inside a fence](nowhere.md)',
      '```',
      '[ref]: ../README.md',
      '[bad ref]: ../MISSING.md',
    ].join('\n');

    expect(brokenLinks('docs/page.md', page, exists)).toEqual([
      'docs/page.md: apps/web/proxy.ts',
      'docs/page.md: ../MISSING.md',
    ]);
    expect(brokenLinks('docs/page.md', '', exists)).toEqual([]);
    expect(brokenLinks('docs/page.md', '[unclosed](retrieval.md', exists)).toEqual([]);
    expect(markdownFiles()).toContain('docs/manual-testing.md');
  });
});
