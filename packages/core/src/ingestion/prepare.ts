import { chunkDocument, type ChunkInput, type ChunkOptions } from './chunk.js';
import { extractTitle } from './markdown.js';
import { deriveMetadata, type DerivedMetadata } from './metadata.js';
import { resolveProjects } from './project.js';
import { scanCorpus } from './scan.js';
import { resolveSupersedence } from './supersede.js';
import { hashText, normalizeText } from './text.js';

export interface PreparedDocument extends DerivedMetadata {
  relativePath: string;
  /** Set in the second pass, from the list of projects that have a brief. */
  project: string | null;
  title: string;
  /** Normalised full text, which is what the hash is taken over. */
  content: string;
  contentHash: string;
  sizeBytes: number;
  chunks: ChunkInput[];
  /** Set in the second pass. The path of the next document in the same series. */
  supersededByPath: string | null;
}

export interface PrepareResult {
  corpusPath: string;
  documents: PreparedDocument[];
}

/**
 * Turns a directory of files into documents ready to be stored.
 *
 * Nothing here touches the database or the network, which is deliberate. Every decision
 * that is easy to get wrong lives in this half of ingestion, so keeping it free of I/O
 * means all of it can be tested quickly and without an API key, and the dry run can
 * show its output for a person to read before anything is written or paid for.
 *
 * The work is two passes, and it has to be. The first reads each file on its own. The
 * second compares documents to each other, which is the only way to know that a release
 * note has been followed by a later one.
 */
export async function prepareCorpus(
  corpusPath: string,
  options: ChunkOptions = {},
): Promise<PrepareResult> {
  const files = await scanCorpus(corpusPath);

  const documents: PreparedDocument[] = files.map((file) => {
    const content = normalizeText(file.content);
    const metadata = deriveMetadata({ relativePath: file.relativePath, content });
    const fallbackTitle = file.relativePath.split('/').at(-1) ?? file.relativePath;

    return {
      ...metadata,
      relativePath: file.relativePath,
      title: extractTitle(content, fallbackTitle),
      content,
      contentHash: hashText(content),
      sizeBytes: file.sizeBytes,
      chunks: chunkDocument(content, options),
      project: null,
      supersededByPath: null,
    };
  });

  const links = resolveSupersedence(
    documents.map((document) => ({
      path: document.relativePath,
      versionSeries: document.versionSeries,
      versionNumber: document.versionNumber,
      temporalDate: document.temporalDate,
    })),
  );

  const projects = resolveProjects(
    documents.map((document) => ({
      path: document.relativePath,
      docType: document.docType,
    })),
  );

  const byPath = new Map(documents.map((document) => [document.relativePath, document]));

  for (const [path, project] of projects) {
    const document = byPath.get(path);
    if (document) document.project = project;
  }

  for (const link of links) {
    const document = byPath.get(link.path);
    if (document) document.supersededByPath = link.supersededByPath;
  }

  return { corpusPath, documents };
}

/** Counts worth showing after a run, and worth asserting in a test. */
export function summarize(result: PrepareResult) {
  const { documents } = result;

  return {
    documents: documents.length,
    chunks: documents.reduce((total, document) => total + document.chunks.length, 0),
    multiChunkDocuments: documents.filter((document) => document.chunks.length > 1).length,
    withDate: documents.filter((document) => document.temporalDate !== null).length,
    dayPrecision: documents.filter((document) => document.temporalPrecision === 'day').length,
    monthPrecision: documents.filter((document) => document.temporalPrecision === 'month').length,
    deprecated: documents.filter((document) => document.isDeprecated).length,
    superseded: documents.filter((document) => document.supersededByPath !== null).length,
    withVersion: documents.filter((document) => document.versionSeries !== null).length,
    withProject: documents.filter((document) => document.project !== null).length,
    docTypes: [...new Set(documents.map((document) => document.docType))].sort(),
  };
}
