export type TemporalPrecision = 'day' | 'month';

export interface DerivedMetadata {
  docType: string;
  temporalDate: string | null;
  temporalPrecision: TemporalPrecision | null;
  /** Where the date came from, so a wrong date can be traced back to its rule. */
  temporalSource: 'filename' | 'heading' | null;
  versionSeries: string | null;
  versionNumber: string | null;
  isDeprecated: boolean;
}

/** A date anywhere in the file name, not only at the start. */
const FILENAME_DAY = /(\d{4})-(\d{2})-(\d{2})/;
const FILENAME_MONTH = /(\d{4})-(\d{2})(?!-\d{2})/;

/** A date in brackets on the title line, which is how the release notes carry theirs. */
const HEADING_DAY = /\((\d{4}-\d{2}-\d{2})\)/;

/** A trailing version, as in `halcyon-runner-5.2`. */
const VERSIONED_NAME = /^(.*?)-(\d+(?:\.\d+)*)$/;

/**
 * An explicit retirement notice, and only that.
 *
 * The narrowness is deliberate and was arrived at by reading the two documents this
 * has to tell apart. The retired guide opens with `# drift agent v2 (DEPRECATED)` and a
 * `Status: deprecated since January 2026` line. The current one opens with
 * `# drift agent v3 (current)` and says, three lines down, `It supersedes v2`.
 *
 * A rule that scanned the opening for words about deprecation would match the second
 * document on the word `supersedes` and mark the current guide as retired, which is
 * exactly backwards and would make the answer wrong rather than merely worse. So a
 * mention is never enough. Only a declaration counts, and there are three places a
 * document can make one:
 *
 * - a status marker in the title, `# drift agent v2 (DEPRECATED)`
 * - a `Status:` line, `Status: deprecated since January 2026`
 * - a line that opens with the word and a colon, `DEPRECATED: replaced by the spec`
 *
 * The third was added after pointing ingestion at a corpus it had never seen, where a
 * retired handbook announced itself that way and was indexed as current. The narrowness
 * survives it: a line that *begins* with `deprecated:` is a declaration in the same way
 * a `Status:` line is, while `It supersedes v2` in the middle of a sentence is not, and
 * no line in the sample collection matches it. That last part was checked rather than
 * assumed, because a rule that changes what the shipped corpus says about itself is a
 * different rule from the one being argued for.
 */
const TITLE_DEPRECATION = /\b(deprecated|retired|obsolete|archived)\b/i;
const STATUS_LINE = /^status\s*:\s*(.+)$/im;
const STATUS_DEPRECATION = /^\s*(deprecated|retired|obsolete|archived)\b/i;
const DECLARED_DEPRECATION = /^\s*(deprecated|retired|obsolete|archived)\s*:/im;

/**
 * Everything that can be worked out about a document without looking at the others.
 *
 * The rules are general on purpose. Nothing here names a file from the sample
 * collection, because a pipeline with the answers written into it would stop working
 * the moment it was pointed somewhere else, and there would be nothing to explain
 * about how it decides.
 */
export function deriveMetadata(input: {
  /** Path relative to the corpus root, using forward slashes. */
  relativePath: string;
  content: string;
}): DerivedMetadata {
  const { relativePath, content } = input;

  const segments = relativePath.split('/');
  const fileName = segments.at(-1) ?? relativePath;
  const stem = fileName.replace(/\.md$/i, '');
  const directory = segments.length > 1 ? (segments.at(-2) ?? null) : null;

  const temporal = deriveTemporal(stem, content);

  // The date is taken out of the name before a version is looked for. Without that,
  // `incident-postmortem-2026-04` reads as version 04 of a series called
  // `incident-postmortem-2026`, because the trailing group of digits after a dash looks
  // exactly like a version number.
  const version = deriveVersion(temporal.raw ? stem.replace(temporal.raw, '') : stem);

  return {
    docType: deriveDocType(directory),
    temporalDate: temporal.date,
    temporalPrecision: temporal.precision,
    temporalSource: temporal.source,
    versionSeries: version.series,
    versionNumber: version.number,
    isDeprecated: deriveDeprecation(content),
  };
}

/**
 * The directory a file sits in, as a singular type name.
 *
 * Files at the root have no directory to describe them, so they are called reference,
 * which is what they are: the standing documents rather than the dated records.
 */
function deriveDocType(directory: string | null): string {
  if (!directory) return 'reference';

  const singular = directory.endsWith('s') ? directory.slice(0, -1) : directory;
  return singular.replace(/-/g, '_');
}

function deriveTemporal(
  stem: string,
  content: string,
): {
  date: string | null;
  precision: TemporalPrecision | null;
  source: 'filename' | 'heading' | null;
  raw: string | null;
} {
  const day = FILENAME_DAY.exec(stem);
  if (day) {
    return {
      date: `${day[1]}-${day[2]}-${day[3]}`,
      precision: 'day',
      source: 'filename',
      raw: day[0],
    };
  }

  // The title line is checked before the month pattern, because a release note carries
  // a full date there while its file name carries only a version number.
  const firstLine = content.split('\n', 1)[0] ?? '';
  const heading = HEADING_DAY.exec(firstLine);
  if (heading?.[1]) {
    return { date: heading[1], precision: 'day', source: 'heading', raw: null };
  }

  const month = FILENAME_MONTH.exec(stem);
  if (month) {
    // Stored as the first of the month. The precision column is what stops that day
    // from being read as the real one.
    return {
      date: `${month[1]}-${month[2]}-01`,
      precision: 'month',
      source: 'filename',
      raw: month[0],
    };
  }

  return { date: null, precision: null, source: null, raw: null };
}

function deriveVersion(stem: string): { series: string | null; number: string | null } {
  const match = VERSIONED_NAME.exec(stem.replace(/^[-_]+|[-_]+$/g, ''));

  if (!match?.[1] || !match[2]) {
    return { series: null, number: null };
  }

  // A series name ending in a four digit year means the digits after it are almost
  // certainly part of a date that the earlier pass did not recognise, not a version.
  if (/\b\d{4}$/.test(match[1])) {
    return { series: null, number: null };
  }

  return { series: match[1], number: match[2] };
}

function deriveDeprecation(content: string): boolean {
  const firstLine = content.split('\n', 1)[0] ?? '';
  if (TITLE_DEPRECATION.test(firstLine)) return true;

  const status = STATUS_LINE.exec(content);
  if (status?.[1] && STATUS_DEPRECATION.test(status[1])) return true;

  return DECLARED_DEPRECATION.test(content);
}
