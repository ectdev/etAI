import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface ScannedFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Path relative to the corpus root, always with forward slashes. */
  relativePath: string;
  content: string;
  sizeBytes: number;
}

const MARKDOWN = /\.mdx?$/i;

/** Directories that are never part of a corpus. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', '.obsidian']);

/**
 * Reads every markdown file under a directory.
 *
 * Paths are made relative to the root and normalised to forward slashes, because they
 * end up in the database as the natural key for a document. Left as absolute paths, the
 * same corpus checked out in a different folder would look like an entirely new set of
 * documents, and re-indexing would duplicate all of them.
 */
export async function scanCorpus(root: string): Promise<ScannedFile[]> {
  const rootStat = await stat(root).catch(() => null);

  if (!rootStat?.isDirectory()) {
    throw new Error(`Corpus path is not a directory: ${root}`);
  }

  const files: ScannedFile[] = [];
  await walk(root, root, files);

  // Sorted so that a run produces the same order every time, which makes two runs
  // comparable and keeps the dry run output stable.
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walk(root: string, directory: string, output: ScannedFile[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      await walk(root, absolutePath, output);
      continue;
    }

    if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;

    const content = await readFile(absolutePath, 'utf8');

    output.push({
      absolutePath,
      relativePath: relative(root, absolutePath).split(sep).join('/'),
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    });
  }
}
