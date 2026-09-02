export interface SupersedableDocument {
  path: string;
  versionSeries: string | null;
  versionNumber: string | null;
  temporalDate: string | null;
}

export interface SupersedenceLink {
  /** The older document. */
  path: string;
  /** The next document in the same series, by date. */
  supersededByPath: string;
}

/**
 * Works out which documents have been followed by a newer one in the same series.
 *
 * This has to be a second pass over the whole collection, and that is the point worth
 * remembering. While a single release note is being read there is no way to know
 * whether a later one exists, so a pipeline that tried to decide this in the same loop
 * that reads the files would leave the field empty and nobody would notice until an
 * answer came back quoting a decision that had since been reversed.
 *
 * Each document points only at its immediate successor rather than at the newest in
 * the series. The collection contains a case where a change is introduced in one
 * release and undone in the next, and the release that undid it is the current answer
 * even though a third, later release exists. Pointing everything at the newest would
 * flatten that ordering and push the correct document down with the wrong one.
 */
export function resolveSupersedence(documents: SupersedableDocument[]): SupersedenceLink[] {
  const series = new Map<string, SupersedableDocument[]>();

  for (const document of documents) {
    if (!document.versionSeries) continue;
    const members = series.get(document.versionSeries) ?? [];
    members.push(document);
    series.set(document.versionSeries, members);
  }

  const links: SupersedenceLink[] = [];

  for (const members of series.values()) {
    if (members.length < 2) continue;

    const ordered = [...members].sort(compareForOrdering);

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const older = ordered[i];
      const newer = ordered[i + 1];
      if (!older || !newer) continue;

      links.push({ path: older.path, supersededByPath: newer.path });
    }
  }

  return links;
}

/**
 * Oldest first.
 *
 * Date decides it. Where two documents in a series carry the same date, or none at all,
 * the version number breaks the tie, compared piece by piece as numbers so that 4.10
 * lands after 4.9 rather than before it the way a string comparison would have it.
 */
function compareForOrdering(a: SupersedableDocument, b: SupersedableDocument): number {
  if (a.temporalDate && b.temporalDate && a.temporalDate !== b.temporalDate) {
    return a.temporalDate < b.temporalDate ? -1 : 1;
  }

  // A document with no date is treated as older than one that has a date, since there
  // is nothing to place it later.
  if (a.temporalDate && !b.temporalDate) return 1;
  if (!a.temporalDate && b.temporalDate) return -1;

  return compareVersionNumbers(a.versionNumber, b.versionNumber);
}

export function compareVersionNumbers(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const left = a.split('.').map((part) => Number.parseInt(part, 10));
  const right = b.split('.').map((part) => Number.parseInt(part, 10));

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }

  return 0;
}
