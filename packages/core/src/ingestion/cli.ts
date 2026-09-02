import { getEnv, resolveFromProjectRoot } from '@etai/shared/env';
import { closeDb } from '@etai/db';
import { ingestCorpus, indexStats } from './persist.js';
import { prepareCorpus, summarize, type PreparedDocument } from './prepare.js';
import { watchCorpus } from './watch.js';

/**
 * Reads the corpus and prints what it made of it.
 *
 * The table is the point of this command. Derived metadata is the part of ingestion
 * that fails quietly: a date pattern that misses a file leaves a null, and nothing
 * complains until a search returns a document that has since been replaced. Printing
 * every row means a person can look down the columns and notice that, say, the release
 * notes have no dates, which is much cheaper than finding out from a wrong answer.
 */

export interface Options {
  corpusPath: string;
  json: boolean;
  filter: string | null;
  showChunks: boolean;
  write: boolean;
  force: boolean;
}

/**
 * Turns the command line into options, or explains why it cannot.
 *
 * Exported so it can be tested without running ingestion. This is the part of the
 * command that decides whether 142 embedding calls happen, and it used to make that
 * decision quietly in two ways.
 *
 * An argument it did not recognise was skipped. `--wrote` instead of `--write` read the
 * whole corpus, printed a table, wrote nothing, and exited zero, which is exactly what a
 * successful dry run looks like. The typo was invisible in the output.
 *
 * And `--force` with `--dry-run` resolved by whichever came last, because one turned
 * writing on and the other turned it off. Two flags that contradict each other should
 * say so rather than pick a winner by position.
 */
export function parseArguments(argv: string[]): Options {
  const env = getEnv();
  let corpusPath = env.CORPUS_PATH;
  let json = false;
  let filter: string | null = null;
  let showChunks = false;
  let write = false;
  let force = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];

    if (argument === '--path' || argument === '-p') {
      const value = argv[i + 1];
      if (!value) throw new Error('--path needs a directory');
      corpusPath = value;
      i += 1;
    } else if (argument?.startsWith('--path=')) {
      const value = argument.slice('--path='.length);
      if (!value) throw new Error('--path needs a directory');
      corpusPath = value;
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--chunks') {
      showChunks = true;
    } else if (argument === '--filter' || argument === '-f') {
      const value = argv[i + 1];
      if (!value) throw new Error('--filter needs some text to match');
      filter = value;
      i += 1;
    } else if (argument?.startsWith('--filter=')) {
      filter = argument.slice('--filter='.length);
    } else if (argument === '--write' || argument === '-w') {
      write = true;
    } else if (argument === '--force') {
      // Re-embeds everything. Only useful when the model or its settings changed, since
      // the hashes cannot notice that.
      force = true;
      write = true;
    } else if (argument === '--dry-run') {
      // The default already writes nothing. The flag exists for the reader who expects
      // it, and it is recorded rather than applied so it can disagree with --force out
      // loud instead of by argument order.
      dryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}. Run with --help to see what exists.`);
    }
  }

  if (dryRun && write) {
    throw new Error(
      'Cannot combine --dry-run with --write or --force. Drop one: --dry-run is the default.',
    );
  }

  return { corpusPath: resolveFromProjectRoot(corpusPath), json, filter, showChunks, write, force };
}

function printHelp() {
  console.log(`
Reads a corpus and reports the metadata derived from it.

  pnpm ingest [options]

  --write, -w      Store what was read, embedding the chunks that changed.
  --force          Re-embed every chunk, for when the model or its settings changed.
  --dry-run        Read and report without storing. This is the default.
  --path <dir>     Directory to read. Defaults to CORPUS_PATH. With --write this
                   becomes the corpus: anything indexed and not in it is removed.
  --filter <text>  Only show rows whose path contains this text.
  --chunks         List each chunk instead of only counting them.
  --json           Print machine readable output instead of a table.
  --help           Show this message.

Without --write nothing is stored: the corpus is read and the derived metadata is
printed so it can be checked before anything is written or paid for.
`);
}

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

function formatDate(document: PreparedDocument): string {
  if (!document.temporalDate) return '-';
  // A month-precision date is shown as a month, because printing a day that was never
  // in the file name would invite someone to trust it.
  return document.temporalPrecision === 'month'
    ? document.temporalDate.slice(0, 7)
    : document.temporalDate;
}

function printTable(documents: PreparedDocument[], showChunks: boolean) {
  const widths = { path: 40, type: 17, date: 10, version: 16, flags: 10, chunks: 6 };

  console.log(
    [
      pad('path', widths.path),
      pad('type', widths.type),
      pad('date', widths.date),
      pad('version', widths.version),
      pad('flags', widths.flags),
      'chunks',
    ].join(' '),
  );
  console.log(
    '-'.repeat(widths.path + widths.type + widths.date + widths.version + widths.flags + 12),
  );

  for (const document of documents) {
    const version =
      document.versionSeries && document.versionNumber
        ? `${document.versionSeries} ${document.versionNumber}`
        : '-';

    const flags = [document.isDeprecated ? 'DEPR' : '', document.supersededByPath ? 'SUPD' : '']
      .filter(Boolean)
      .join(' ');

    console.log(
      [
        pad(document.relativePath, widths.path),
        pad(document.docType, widths.type),
        pad(formatDate(document), widths.date),
        pad(version, widths.version),
        pad(flags || '-', widths.flags),
        String(document.chunks.length),
      ].join(' '),
    );

    if (showChunks) {
      for (const chunk of document.chunks) {
        console.log(
          `      [${chunk.position}] ${chunk.tokenCount} tokens  ${chunk.headingPath ?? '(no heading)'}`,
        );
      }
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const started = Date.now();

  if (options.write) {
    await runWrite(options);
    return;
  }

  const result = await prepareCorpus(options.corpusPath);
  const documents = options.filter
    ? result.documents.filter((document) =>
        document.relativePath.includes(options.filter as string),
      )
    : result.documents;

  if (options.json) {
    console.log(JSON.stringify({ summary: summarize(result), documents }, null, 2));
    return;
  }

  console.log(`\nCorpus: ${result.corpusPath}\n`);
  printTable(documents, options.showChunks);

  const summary = summarize(result);
  console.log(`
Documents      ${summary.documents}
Chunks         ${summary.chunks} (${summary.multiChunkDocuments} documents produced more than one)
Dated          ${summary.withDate} of ${summary.documents} (${summary.dayPrecision} to the day, ${summary.monthPrecision} to the month)
Deprecated     ${summary.deprecated}
Superseded     ${summary.superseded}
Versioned      ${summary.withVersion}
With project   ${summary.withProject}
Types          ${summary.docTypes.join(', ')}

Read in ${Date.now() - started} ms. Nothing was written: add --write to store it.
`);
}

async function runWrite(options: Options) {
  try {
    const summary = await ingestCorpus({
      corpusPath: options.corpusPath,
      trigger: 'cli',
      force: options.force,
      onProgress: (message) => console.log(message),
    });

    const stats = await indexStats();

    if (options.json) {
      console.log(JSON.stringify({ summary, stats }, null, 2));
      return;
    }

    console.log(`
Run            ${summary.runId}
Status         ${summary.status}
Created        ${summary.created}
Updated        ${summary.updated}
Skipped        ${summary.skipped}
Deleted        ${summary.deleted}
Failed         ${summary.failed}
Chunks embedded ${summary.chunksEmbedded}
Duration       ${summary.durationMs} ms

Index now holds ${stats.documents} documents and ${stats.chunks} chunks, ${stats.embedded} of them embedded.
`);

    if (summary.failures.length > 0) {
      console.log('Failures:');
      for (const failure of summary.failures) {
        console.log(`  ${failure.path}: ${failure.error}`);
      }
      // A partial run is a real outcome rather than a success, so the exit code says so
      // and a scheduled caller can notice.
      process.exitCode = 1;
    }

    if (getEnv().INGEST_WATCH) {
      await stayAndWatch(options.corpusPath);
    }
  } finally {
    await closeDb();
  }
}

/**
 * Holds the process open, reindexing when the corpus changes, until Ctrl-C.
 *
 * The initial run above has already happened, so watching starts from an index that
 * matches the corpus. Returns once the signal has been handled and the watcher has
 * finished whatever it was doing, which is what lets the `finally` above close the
 * database on a connection nothing is still using.
 */
async function stayAndWatch(corpusPath: string): Promise<void> {
  console.log(`\nWatching ${corpusPath}. Ctrl-C to stop.\n`);

  const watcher = watchCorpus({
    corpusPath,
    onEvent: (event) => {
      if (event.kind === 'waiting') console.log(`Change detected, waiting ${event.ms} ms`);
      if (event.kind === 'coalesced') console.log('Changed during a run, queued one more');
      if (event.kind === 'started') console.log(`Reindexing${event.queued ? ' (queued)' : ''}`);
      if (event.kind === 'finished') console.log(`Done in ${event.ms} ms`);
      if (event.kind === 'failed') console.error(`Run failed: ${event.error.message}`);
      if (event.kind === 'dropped') console.log('Stopped with changes still pending');
    },
  });

  await new Promise<void>((resolve) => {
    // `once`, so a second Ctrl-C on a run that is taking too long reaches the default
    // handler and ends the process rather than being swallowed.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        console.log('\nStopping.');
        void watcher.close().then(resolve);
      });
    }
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
