export interface ProjectCandidate {
  path: string;
  docType: string;
}

/**
 * Works out which documents belong to which project.
 *
 * The first attempt at this was a single-document rule: take the file name, remove the
 * date, and call what is left the project. It produced a project called
 * `outage-review` and another called `weekly-sync`, because the leftover text
 * is only a project name in the files that happen to be named after one.
 *
 * The collection already contains the answer. There is a folder of account profiles,
 * one per account, and the file names in it are the list of projects that exist. So the list is
 * read from there and matched against every other path, which means no name is invented
 * and a document is only assigned to a project that has a profile of its own.
 *
 * Like supersedence, this cannot be decided while reading one file, because the list is
 * not known until the whole collection has been seen.
 *
 * A corpus with no account profiles simply gets no project labels, which is the honest outcome:
 * without a canonical list there is nothing to match against, and guessing would put
 * wrong labels on documents rather than leaving them unlabelled.
 */
export function resolveProjects(documents: ProjectCandidate[]): Map<string, string> {
  const profileType = 'account';

  const projects = documents
    .filter((document) => document.docType === profileType)
    .map((document) => slugFromPath(document.path))
    .filter((slug): slug is string => slug !== null);

  const assignments = new Map<string, string>();
  if (projects.length === 0) return assignments;

  // Longest first, so a project whose name contains another project's name is matched
  // before the shorter one can claim the document.
  const ordered = [...new Set(projects)].sort((a, b) => b.length - a.length);

  for (const document of documents) {
    if (document.docType === profileType) {
      const slug = slugFromPath(document.path);
      if (slug) assignments.set(document.path, slug);
      continue;
    }

    // Every part of the path, not only the file name, because an account's records can
    // live in a folder named after it: `migrations/alpine-ledger/2025-11.md`.
    const names = document.path.replace(/\.mdx?$/i, '').split('/');
    const match = ordered.find((project) => names.some((name) => name.includes(project)));
    if (match) assignments.set(document.path, match);
  }

  return assignments;
}

function slugFromPath(path: string): string | null {
  const fileName = path.split('/').at(-1);
  if (!fileName) return null;
  return fileName.replace(/\.mdx?$/i, '');
}
