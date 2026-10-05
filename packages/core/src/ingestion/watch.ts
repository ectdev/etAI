import { watch, type FSWatcher } from 'node:fs';
import { ingestCorpus, type IngestSummary } from './persist.js';
import { createScheduler, type SchedulerEvent } from './schedule.js';

/**
 * Reindexes the corpus when it changes on disk.
 *
 * The watcher's only job is noticing that something happened. What changed is worked out
 * afterwards by the same hash comparison the command line uses, because the notifications
 * cannot answer it: a branch switch touching 30 files reported 13 filenames on the machine
 * this was built on. Every run here goes through `ingestCorpus`, so a file saved with no
 * edit costs a hash comparison and nothing else.
 */

const MARKDOWN = /\.mdx?$/i;

export interface WatchOptions {
  corpusPath: string;
  debounceMs?: number;
  /** Defaults to `ingestCorpus`. Replaced in tests so nothing reaches a model. */
  ingest?: (options: { corpusPath: string; queued: boolean }) => Promise<unknown>;
  onEvent?: (event: SchedulerEvent) => void;
}

export interface CorpusWatcher {
  /** Stops watching and waits for a run already in progress. */
  close: () => Promise<void>;
}

export function watchCorpus(options: WatchOptions): CorpusWatcher {
  const ingest =
    options.ingest ??
    ((context): Promise<IngestSummary> =>
      ingestCorpus({
        corpusPath: context.corpusPath,
        trigger: 'watch',
        queued: context.queued,
      }));

  const scheduler = createScheduler({
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    run: async ({ queued }) => {
      await ingest({ corpusPath: options.corpusPath, queued });
    },
  });

  let watcher: FSWatcher | undefined = watch(
    options.corpusPath,
    { recursive: true },
    (_type, name) => {
      // `type` is not consulted. A deletion and a creation both arrive as "rename", so it
      // does not separate them, and the diff has to read the corpus either way.
      //
      // A null name means the platform reported a change without saying where. That is
      // taken as a change, since the alternative is ignoring it.
      if (name !== null && !MARKDOWN.test(name)) return;

      scheduler.notify();
    },
  );

  return {
    async close(): Promise<void> {
      watcher?.close();
      watcher = undefined;
      await scheduler.close();
    },
  };
}
