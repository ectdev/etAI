import { closeDb } from '@etai/db';
import { citationMarkers } from '@etai/shared';
import { answerQuestion } from '../generation/answer.js';

/**
 * A curious person having one conversation, rather than twelve strangers asking one
 * question each.
 *
 * Every measurement in this project so far has treated a question as independent, because
 * that is what the API is. A real session is not: people follow up, change subject, come
 * back to something five turns later, and refer to what they were told rather than
 * repeating it. This runs that shape and prints what happens, to find out what breaks
 * rather than to assert that nothing does.
 *
 * The turns marked `refersBack` are the ones that cannot be answered from their own text.
 */
interface Turn {
  ask: string;
  /** Which earlier turn this depends on, when it depends on one. */
  refersBack?: number;
  watchFor: string;
}

const CONVERSATION: Turn[] = [
  { ask: 'What is the maximum file size for an AppLovin playable?', watchFor: '5 MB' },
  { ask: 'Which languages must every playable ship with?', watchFor: 'the language list' },
  { ask: 'How do I initialize the current Lumen SDK?', watchFor: 'LumenSDK.init' },
  {
    ask: 'What happened to lumen.track?',
    refersBack: 3,
    watchFor: 'that it was removed with v2, which the previous turn was about',
  },
  { ask: 'What caused the March 2026 AppLovin rejections?', watchFor: 'the stage order change' },
  {
    ask: 'Was that fixed?',
    refersBack: 5,
    watchFor: '"that" is the March 2026 incident, not a fresh subject',
  },
  { ask: 'What is the ironSource file size limit?', watchFor: 'partial coverage' },
  {
    ask: 'Going back to the file size you gave me first, does it include the end card?',
    refersBack: 1,
    watchFor: 'the AppLovin 5 MB limit from seven turns earlier',
  },
  { ask: 'thanks!', watchFor: 'a polite refusal rather than a search' },
  {
    ask: 'And the second language you listed earlier?',
    refersBack: 2,
    watchFor: 'the second entry of a list this conversation already produced',
  },
  { ask: 'Why are sound assets built in a separate pass?', watchFor: 'the incident behind it' },
  {
    ask: 'Of everything I have asked about, which one is out of date?',
    refersBack: 3,
    watchFor: 'the retired SDK guide, which only this conversation knows was discussed',
  },
];

async function main() {
  console.log(`Twelve turns, ${CONVERSATION.length} of them from one person.\n`);

  let brokeOnReference = 0;

  for (const [index, turn] of CONVERSATION.entries()) {
    const result = await answerQuestion(turn.ask);
    const number = index + 1;
    const back = turn.refersBack ? ` (refers back to turn ${turn.refersBack})` : '';

    console.log(`${'-'.repeat(92)}`);
    console.log(`turn ${number}${back}: ${turn.ask}`);
    console.log(`  looking for: ${turn.watchFor}`);
    console.log(`  coverage:    ${result.coverage}`);
    console.log(`  markers:     [${citationMarkers(result.answer).join(', ')}]`);
    console.log(
      `  cited:       ${result.citations.map((c) => c.documentPath).join(', ') || 'none'}`,
    );
    console.log(`  answer:      ${result.answer.slice(0, 220) || '(empty)'}`);
    if (result.gap) console.log(`  gap:         ${result.gap.slice(0, 180)}`);

    // A turn that depends on an earlier one and comes back refused is the failure this
    // probe exists to find: the system had the answer, in this conversation, and lost it.
    if (
      turn.refersBack &&
      (result.coverage === 'not_documented' || result.coverage === 'out_of_scope')
    ) {
      brokeOnReference += 1;
      console.log(`  >>> LOST: this turn depended on turn ${turn.refersBack} and was refused.`);
    }
  }

  const referring = CONVERSATION.filter((turn) => turn.refersBack).length;
  console.log(`\n${'='.repeat(92)}`);
  console.log(`Turns that referred to an earlier one: ${referring}`);
  console.log(`Of those, refused outright: ${brokeOnReference}`);

  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
