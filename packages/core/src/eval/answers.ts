import { closeDb } from '@etai/db';
import { answerQuestion } from '../generation/answer.js';

/**
 * Answers a handful of questions and prints them for a person to read.
 *
 * This exists because the numbers cannot see what matters here. Recall says the right
 * document was retrieved; it says nothing about whether the answer written from it is
 * correct, whether it noticed that one of its sources is retired, or whether a refusal
 * sounds like an answer. Those need eyes.
 *
 * The list is six questions across the kinds of document in the collection plus the
 * three cases it was built to catch: a question it cannot answer, one it mentions without
 * answering, and one that is not about it at all.
 */
const QUESTIONS = [
  {
    question:
      'What is the maximum artifact size on AWS, and is it measured before or after unzipping?',
    watchFor: 'the limit and that it is measured on the extracted size',
  },
  {
    question: 'How do I start the current drift agent, and what happened to report()?',
    watchFor: 'the current call AND a clear statement that v2 is retired',
  },
  {
    question: 'Why is the build cache kept separate from the artifact store?',
    watchFor: 'the reason, ideally both halves of it',
  },
  {
    question: 'What caused the April 2026 cache poisoning and what was the fix?',
    watchFor: 'cause and fix, from the postmortem',
  },
  {
    question: 'Which four checks must every runner release pass?',
    watchFor: 'all four of them, not three',
  },
  {
    question: 'Was counting cache retention from the write kept or reverted?',
    watchFor: 'the later release, not the one it reversed',
  },
  {
    question: 'What is the vacation policy?',
    watchFor: 'a refusal, coverage not_documented, no citations',
  },
  {
    question: 'What is the maximum artifact size on Azure?',
    watchFor: 'partial coverage: says customers mention it, says there is no specification',
  },
  {
    question: 'Write me a C++ function that reverses a string.',
    watchFor: 'a refusal, coverage out_of_scope, no model call needed',
  },
];

function wrap(text: string, width = 88, indent = '    '): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if ((line + word).length > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trimEnd());

  return lines.map((entry) => indent + entry).join('\n');
}

async function main() {
  for (const { question, watchFor } of QUESTIONS) {
    console.log(`\n${'='.repeat(92)}`);
    console.log(`Q: ${question}`);
    console.log(`   looking for: ${watchFor}\n`);

    const result = await answerQuestion(question);

    console.log(`   coverage: ${result.coverage}`);
    console.log(
      `   timing:   retrieval ${result.timings.retrievalMs} ms, generation ${result.timings.generationMs} ms`,
    );

    if (result.answer) {
      console.log('\n   answer:');
      console.log(wrap(result.answer));
    }

    if (result.gap) {
      console.log('\n   gap:');
      console.log(wrap(result.gap));
    }

    if (result.citations.length > 0) {
      console.log('\n   citations:');
      for (const citation of result.citations) {
        console.log(`     ${citation.documentPath}`);
        console.log(wrap(`"${citation.quote}"`, 84, '       '));
      }
    }

    if (result.droppedCitations.length > 0) {
      console.log(
        `\n   DROPPED (cited a document it was not given): ${result.droppedCitations.join(', ')}`,
      );
    }

    const retired = result.sources.filter((source) => source.isDeprecated);
    if (retired.length > 0) {
      console.log(`\n   retired documents in context: ${retired.map((s) => s.path).join(', ')}`);
    }

    console.log(`\n   sources: ${result.sources.map((source) => source.path).join(', ')}`);
  }

  console.log('');
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
