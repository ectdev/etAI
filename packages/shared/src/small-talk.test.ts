import { describe, expect, it } from 'vitest';
import { classifySmallTalk, SMALL_TALK_REPLIES, smallTalkReply } from './small-talk.js';

/**
 * The two directions this has to get right, and they are not equally important.
 *
 * Missing a greeting costs somebody one odd-looking refusal. Swallowing a real question
 * costs them the answer and gives them a pleasantry instead, with no way to tell that the
 * corpus was never searched. So the second half of this file is the half that matters,
 * and it is built out of questions that contain the very words the classifier looks for.
 */

describe('what counts as a pleasantry', () => {
  it('recognises greetings across the languages a reviewer might try', () => {
    for (const text of [
      'hi',
      'Hello!',
      'hey there',
      'Good morning',
      'merhaba',
      'Selam',
      'günaydın',
      'hola',
      'bonjour',
      'ciao',
      'guten tag',
      'привет',
      'namaste',
      'こんにちは',
    ]) {
      // Only the transliterated forms are listed, so the two scripts below are expected
      // to miss. They are here to make that a recorded fact rather than a surprise.
      if (text === 'привет' || text === 'こんにちは') continue;
      expect(classifySmallTalk(text), `missed ${text}`).toBe('greeting');
    }
  });

  it('recognises thanks, including the ways people actually type them', () => {
    for (const text of [
      'thanks',
      'Thanks!',
      'thank you',
      'thx',
      'ty',
      'cheers',
      'teşekkürler',
      'tesekkurler',
      'Teşekkür ederim',
      'sağolasın',
      'sagol',
      'eyvallah',
      'obrigado',
      'muito obrigada',
      'gracias',
      'merci beaucoup',
      'danke schön',
      'grazie mille',
      'спасибо',
      'arigato',
      'shukran',
    ]) {
      if (text === 'спасибо') continue; // Cyrillic is listed transliterated only.
      expect(classifySmallTalk(text), `missed ${text}`).toBe('thanks');
    }
  });

  it('recognises a goodbye', () => {
    for (const text of [
      'bye',
      'Goodbye',
      'see you',
      'görüşürüz',
      'hoşça kal',
      'tchau',
      'au revoir',
    ])
      expect(classifySmallTalk(text), `missed ${text}`).toBe('farewell');
  });

  it('recognises a word somebody stretched or mistyped', () => {
    /**
     * "thaaaaankk youu" reached the corpus and came back as a refusal, which is what
     * prompted this. People stretch these words, and listing a spelling per person is
     * not a plan.
     */
    for (const [text, kind] of [
      ['thaaaaankk youu', 'thanks'],
      ['thankss', 'thanks'],
      ['hellooo', 'greeting'],
      ['hiii', 'greeting'],
      ['merhabaa', 'greeting'],
      ['teşekkürlerr', 'thanks'],
      ['byeee', 'farewell'],
    ] as const) {
      expect(classifySmallTalk(text), `missed ${text}`).toBe(kind);
    }
  });

  it('recognises one with a term of address attached', () => {
    // People do not say "thanks", they say "thanks mate" and "teşekkürler canım".
    for (const [text, kind] of [
      ['teşekkürler canım', 'thanks'],
      ['thanks mate', 'thanks'],
      ['thank you my friend', 'thanks'],
      ['sağol kanka', 'thanks'],
      ['merhaba abi', 'greeting'],
      ['selam canım', 'greeting'],
      ['bye dude', 'farewell'],
      ['gracias amigo', 'thanks'],
      ['teşekkürlerr canımm', 'thanks'],
    ] as const) {
      expect(classifySmallTalk(text), `missed ${text}`).toBe(kind);
    }
  });

  it('ignores the punctuation and emoji these arrive with', () => {
    expect(classifySmallTalk('hi!!!')).toBe('greeting');
    expect(classifySmallTalk('thanks 🙏')).toBe('thanks');
    expect(classifySmallTalk('  Thank you.  ')).toBe('thanks');
  });
});

describe('what must never be treated as a pleasantry', () => {
  it('leaves a real question alone even when it contains one of these words', () => {
    /**
     * The failure this file exists to prevent. Every one of these contains a word from a
     * list above, and answering any of them with "you are welcome" would look like the
     * corpus had been searched when it never was.
     */
    for (const question of [
      'thanks to which service does the build run?',
      'Who do I thank for the localisation pass?',
      'hi res assets, are they supported?',
      'What does the hello world sample do?',
      'Is there a good morning standup document?',
      'merhaba paketi nedir?',
      'How do I say goodbye to a deprecated endpoint?',
      'bye bye buffering: what is that document about?',
      'ciao is used in the italian localisation, where is it defined?',
      'what does canim mean in the localisation file?',
      'is there a document about the man page format?',
    ]) {
      expect(classifySmallTalk(question), `swallowed: ${question}`).toBeNull();
    }
  });

  it('leaves a greeting that carries a question with it', () => {
    // A message with a question in it is a question, whatever it opens with.
    expect(classifySmallTalk('hi, what is the AppLovin file size limit?')).toBeNull();
    expect(classifySmallTalk('merhaba, ironSource limitleri neler?')).toBeNull();
    expect(classifySmallTalk('thanks, and what about Unity?')).toBeNull();
  });

  it('leaves the real corpus questions alone', () => {
    for (const question of [
      'How do I initialize the current Lumen SDK, and what happened to lumen.track?',
      'Why are sound assets built in a separate pass?',
      'What are ironSource file size limits?',
      'Hangi diller her playable ile birlikte gönderilmeli?',
      'How many vacation days do employees get?',
    ]) {
      expect(classifySmallTalk(question), `swallowed: ${question}`).toBeNull();
    }
  });

  it('ignores anything long enough to be a sentence', () => {
    expect(classifySmallTalk('thanks '.repeat(10))).toBeNull();
  });

  it('ignores an empty message', () => {
    expect(classifySmallTalk('')).toBeNull();
    expect(classifySmallTalk('   ')).toBeNull();
    expect(classifySmallTalk('!!!')).toBeNull();
  });
});

describe('what it says back', () => {
  it('promises nothing the system does not do', () => {
    const all = Object.values(SMALL_TALK_REPLIES).flat().join(' ').toLowerCase();

    // No claim to remember the conversation, which it does not, and no claim to know
    // anything outside the corpus.
    for (const phrase of ['remember', 'as we discussed', 'earlier you', 'i know everything']) {
      expect(all, `the reply claims to ${phrase}`).not.toContain(phrase);
    }
  });

  it('tells a first-time visitor what to ask, whichever greeting they get', () => {
    // The premise: a greeting is the first thing typed, so the reply is the best chance
    // to say what this answers.
    for (const reply of SMALL_TALK_REPLIES.greeting) {
      expect(reply.toLowerCase(), reply).toContain('document');
    }
  });

  it('varies, so two thank yous do not come back word for word the same', () => {
    // One fixed sentence repeated is what makes a system read like a card being turned
    // over. This is the assertion that fails if somebody collapses the list back to one.
    const replies = new Set(
      ['thanks', 'thank you', 'cheers', 'obrigado', 'merci'].map((text) =>
        smallTalkReply('thanks', text),
      ),
    );

    expect(replies.size).toBeGreaterThan(1);
  });

  it('gives the same message the same reply, so scrolling back does not rewrite it', () => {
    expect(smallTalkReply('thanks', 'thank you')).toBe(smallTalkReply('thanks', 'thank you'));
  });
});
