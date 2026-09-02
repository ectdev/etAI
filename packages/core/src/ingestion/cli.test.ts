import { describe, expect, it } from 'vitest';
import { parseArguments } from './cli.js';

/**
 * The command line in front of ingestion.
 *
 * This parser decides whether a run costs 142 embedding calls or nothing, which makes it
 * worth more attention than argument parsing usually gets. The cases that matter are the
 * ones where getting it wrong produces output that looks fine: a mistyped flag that
 * silently does nothing, and two flags that disagree resolving by position.
 */
describe('reading the ingest command line', () => {
  it('writes nothing unless it is asked to', () => {
    // The safe default. Somebody trying the command for the first time should not spend
    // an embedding budget finding out what it does.
    expect(parseArguments([]).write).toBe(false);
    expect(parseArguments(['--chunks', '--json']).write).toBe(false);
  });

  it('refuses an argument it does not recognise', () => {
    /**
     * The failure this exists for.
     *
     * `--wrote` used to be skipped, so the command read the whole corpus, printed its
     * table, stored nothing and exited zero. That is indistinguishable from a successful
     * dry run, and the person who typed it believes their corpus is indexed.
     */
    expect(() => parseArguments(['--wrote'])).toThrow(/Unknown argument/);
    expect(() => parseArguments(['--write', '--verbose'])).toThrow(/--verbose/);
    expect(() => parseArguments(['-x'])).toThrow(/Unknown argument/);
  });

  it('names the flag it did not understand, and points at the help', () => {
    // An error that says "unknown argument" and stops there sends someone to the source.
    expect(() => parseArguments(['--frce'])).toThrow(/--frce/);
    expect(() => parseArguments(['--frce'])).toThrow(/--help/);
  });

  it('refuses two flags that contradict each other, in either order', () => {
    // Order dependence is the real defect here. Both of these used to be accepted and
    // they did different things.
    expect(() => parseArguments(['--force', '--dry-run'])).toThrow(/Cannot combine/);
    expect(() => parseArguments(['--dry-run', '--force'])).toThrow(/Cannot combine/);
    expect(() => parseArguments(['--write', '--dry-run'])).toThrow(/Cannot combine/);
  });

  it('accepts --dry-run on its own, because the help says it exists', () => {
    expect(parseArguments(['--dry-run']).write).toBe(false);
  });

  it('turns writing on for --force, since re-embedding nothing would be pointless', () => {
    const options = parseArguments(['--force']);

    expect(options.force).toBe(true);
    expect(options.write).toBe(true);
  });

  it('accepts a value either as a separate argument or after an equals sign', () => {
    // Both forms are in common use and a reader should not have to remember which one
    // this command wanted.
    expect(parseArguments(['--filter', 'changelog']).filter).toBe('changelog');
    expect(parseArguments(['--filter=changelog']).filter).toBe('changelog');
  });

  it('refuses a flag whose value is missing rather than reading the next flag as one', () => {
    // Without this, `--filter --json` sets the filter to "--json" and then quietly
    // filters every row away.
    expect(() => parseArguments(['--path'])).toThrow(/needs a directory/);
    expect(() => parseArguments(['--path='])).toThrow(/needs a directory/);
    expect(() => parseArguments(['--filter'])).toThrow(/needs some text/);
  });

  it('resolves a relative corpus path against the project rather than the shell', () => {
    // The command is run from several directories in this repo, and a path resolved
    // against the working directory would mean a different corpus each time.
    expect(parseArguments(['--path', './corpus']).corpusPath).toMatch(/^\//);
  });
});
