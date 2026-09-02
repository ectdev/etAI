/**
 * Recognising a greeting, a thank you or a goodbye, so they do not get a refusal.
 *
 * "hi" used to go through retrieval, match nothing above the relevance floor, and come
 * back as "this collection does not cover that question". It is a correct sentence and a
 * ridiculous thing to say to somebody who said hello, and it is the first thing a person
 * types into a chat box.
 *
 * The rule is deliberately narrow: the whole message, once normalised, has to be one of
 * the phrases below. Matching anything that merely contains "thanks" would swallow
 * "thanks to which service does the build run", and a question turned into a pleasantry
 * is a much worse failure than a pleasantry turned into a refusal.
 *
 * No language detection and no model call. This runs before the request is made, so it
 * costs nothing and answers immediately.
 */

export type SmallTalk = 'greeting' | 'thanks' | 'farewell';

/**
 * Letters that are not an accented form of anything, so NFD leaves them alone.
 *
 * Turkish dotless i is the one that matters here: "sagolasin" and "sağolasın" differ by a
 * character that decomposition never touches, so both spellings missed until this map
 * existed. The rest are the same problem in other alphabets.
 */
const STANDALONE: Record<string, string> = {
  ı: 'i',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

/**
 * Lowercased, stripped of punctuation, and with diacritics removed.
 *
 * The diacritics matter more than they look. People type Turkish without them constantly,
 * so "teşekkürler" and "tesekkurler" are the same word to a reader and two different
 * strings to a Set. Decomposing and dropping the combining marks makes one entry cover
 * both, and does the same for "gracias", "merci" and the rest.
 */
function normalise(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[ıøđðłßæœþ]/g, (letter) => STANDALONE[letter] ?? letter)
      .replace(/[!?.,;:'"()\-_*~`]/g, ' ')
      // Emoji and other symbols, which arrive attached to exactly this kind of message.
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Longer than this is not a pleasantry.
 *
 * A guard rather than a rule: every phrase listed below is well under it. It is here so
 * that a normalisation bug cannot turn a long question into an accidental match.
 */
const LONGEST = 40;

const GREETINGS = new Set([
  // English
  'hi',
  'hi there',
  'hello',
  'hello there',
  'hey',
  'hey there',
  'yo',
  'good morning',
  'good afternoon',
  'good evening',
  'howdy',
  'greetings',
  // Turkish
  'merhaba',
  'selam',
  'selamlar',
  'gunaydin',
  'iyi gunler',
  'iyi aksamlar',
  'naber',
  'nasilsin',
  // Spanish and Portuguese
  'hola',
  'buenos dias',
  'buenas tardes',
  'ola',
  'bom dia',
  'boa tarde',
  // French, German, Italian, Dutch
  'bonjour',
  'salut',
  'coucou',
  'hallo',
  'guten tag',
  'guten morgen',
  'servus',
  'moin',
  'ciao',
  'buongiorno',
  'salve',
  'hoi',
  'goedendag',
  // Nordic, Slavic, Greek
  'hej',
  'hejsan',
  'hei',
  'moi',
  'czesc',
  'dzien dobry',
  'privet',
  'zdravstvuyte',
  'zdravo',
  'ahoj',
  'geia',
  'yasou',
  // Arabic, Hebrew, Persian, Hindi, Urdu
  'salam',
  'assalamu alaikum',
  'marhaba',
  'ahlan',
  'shalom',
  'namaste',
  'namaskar',
  'salaam',
  // East Asian
  'konnichiwa',
  'ohayo',
  'annyeong',
  'annyeonghaseyo',
  'ni hao',
  'nihao',
  'xin chao',
  'sawasdee',
  'halo',
  'kumusta',
]);

const THANKS = new Set([
  // English
  'thanks',
  'thank you',
  'thank u',
  'thanks a lot',
  'thanks so much',
  'thank you so much',
  'thank you very much',
  'many thanks',
  'thx',
  'tx',
  'ty',
  'tysm',
  'cheers',
  'much appreciated',
  'appreciate it',
  'nice one',
  'perfect thanks',
  'great thanks',
  // Turkish
  'tesekkurler',
  'tesekkur ederim',
  'cok tesekkurler',
  'cok tesekkur ederim',
  'tesekkurederim',
  'sagol',
  'sag ol',
  'sagolasin',
  'sag olasin',
  'sagolun',
  'eyvallah',
  'eline saglik',
  'tsk',
  // Spanish and Portuguese
  'gracias',
  'muchas gracias',
  'mil gracias',
  'obrigado',
  'obrigada',
  'muito obrigado',
  'muito obrigada',
  'valeu',
  // French, German, Italian, Dutch
  'merci',
  'merci beaucoup',
  'danke',
  'danke schon',
  'vielen dank',
  'danke sehr',
  'grazie',
  'grazie mille',
  'dank je',
  'dank u',
  'bedankt',
  // Nordic, Slavic, Greek
  'tack',
  'tack sa mycket',
  'takk',
  'tak',
  'kiitos',
  'dziekuje',
  'dzieki',
  'spasibo',
  'bolshoe spasibo',
  'hvala',
  'dekuji',
  'multumesc',
  'efharisto',
  'efcharisto',
  // Arabic, Hebrew, Persian, Hindi, Urdu
  'shukran',
  'shukran jazilan',
  'toda',
  'toda raba',
  'mamnoon',
  'merci ziad',
  'dhanyavaad',
  'dhanyawad',
  'shukriya',
  // East Asian
  'arigato',
  'arigatou',
  'domo arigato',
  'kamsahamnida',
  'gamsahamnida',
  'xie xie',
  'xiexie',
  'cam on',
  'khob khun',
  'terima kasih',
  'salamat',
]);

const FAREWELLS = new Set([
  'bye',
  'byebye',
  'bye bye',
  'goodbye',
  'good bye',
  'see you',
  'see ya',
  'later',
  'take care',
  'good night',
  'goodnight',
  'gorusuruz',
  'hoscakal',
  'hosca kal',
  'kendine iyi bak',
  'iyi geceler',
  'gule gule',
  'adios',
  'hasta luego',
  'chau',
  'tchau',
  'ate logo',
  'au revoir',
  'a bientot',
  'tschuss',
  'auf wiedersehen',
  'arrivederci',
  'a presto',
  'doei',
  'hej da',
  'pa pa',
  'do svidaniya',
  'sayonara',
  'annyeonghi gyeseyo',
  'zai jian',
  'zaijian',
]);

/**
 * Terms of address people attach to a greeting or a thank you.
 *
 * "teşekkürler canım" is a thank you and did not match, because the phrase list holds
 * thank yous rather than every way of addressing the person receiving one. Stripping
 * these lets one entry cover all of them, and they are only ever removed from the ends,
 * so "what does canım mean in the localisation file" keeps its words and stays a question.
 */
const ENDEARMENTS = new Set([
  // Turkish
  'canim',
  'cicim',
  'cicom',
  'abi',
  'abicim',
  'abla',
  'kanka',
  'kankam',
  'kardesim',
  'dostum',
  'hocam',
  'ustadim',
  'birader',
  'moruk',
  'reis',
  'askim',
  'gulum',
  'be',
  'ya',
  'ki',
  // English and elsewhere
  'mate',
  'dude',
  'man',
  'bro',
  'buddy',
  'pal',
  'friend',
  'boss',
  'chief',
  'habibi',
  'amigo',
  // A modifier rather than a term of address, so that "my friend" reduces to nothing
  // after "friend" has gone. Only ever removed from an end, and only while a word remains.
  'my',
  'hermano',
  'bruv',
]);

/** Drops terms of address from either end, leaving the pleasantry itself. */
function stripEndearments(text: string): string {
  const words = text.split(' ').filter(Boolean);

  while (words.length > 1 && ENDEARMENTS.has(words[words.length - 1] as string)) words.pop();
  while (words.length > 1 && ENDEARMENTS.has(words[0] as string)) words.shift();

  return words.join(' ');
}

/**
 * Collapses a letter repeated two or more times down to one.
 *
 * People stretch these words and they mistype them: "thaaaaankk youu", "hellooo",
 * "merhabaa". None of those matched, and every one of them is obviously a thank you or a
 * hello. Squeezing both the message and the phrase list the same way makes one entry
 * cover all of them without listing a spelling per person.
 *
 * Applied only as a second pass, after the exact match fails, so ordinary text is never
 * altered on the way to a search.
 */
function squeeze(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

const SQUEEZED: Array<[Set<string>, SmallTalk]> = [
  [new Set([...GREETINGS].map(squeeze)), 'greeting'],
  [new Set([...THANKS].map(squeeze)), 'thanks'],
  [new Set([...FAREWELLS].map(squeeze)), 'farewell'],
];

/**
 * What kind of pleasantry this is, or null when it is anything else.
 *
 * Null is the answer for every real question, including one that begins with a greeting,
 * because a message with a question in it is a question.
 */
export function classifySmallTalk(text: string): SmallTalk | null {
  const clean = normalise(text);

  if (clean.length === 0 || clean.length > LONGEST) return null;

  // Four passes, cheapest first: as typed, without terms of address, with stretched
  // letters collapsed, and both.
  /**
   * Cheapest first, and squeezing before stripping as well as after.
   *
   * "teşekkürlerr canımm" needs both, in that order: the term of address is stretched
   * too, so it does not match the list until the repeated letters are gone.
   */
  for (const candidate of [
    clean,
    stripEndearments(clean),
    squeeze(clean),
    stripEndearments(squeeze(clean)),
  ]) {
    if (GREETINGS.has(candidate)) return 'greeting';
    if (THANKS.has(candidate)) return 'thanks';
    if (FAREWELLS.has(candidate)) return 'farewell';

    for (const [set, kind] of SQUEEZED) if (set.has(candidate)) return kind;
  }

  return null;
}

/**
 * What to say back.
 *
 * Several per kind, because one fixed sentence repeated verbatim is what makes a system
 * feel like a machine reading from a card. Saying thank you twice and getting the same
 * words twice is worse than a plain refusal would have been.
 *
 * All of them are written to be true. None claims to remember the conversation, which it
 * does not, and the greetings say what this can actually answer, since the most useful
 * thing to tell somebody who has just arrived is what to ask.
 */
const REPLIES: Record<SmallTalk, readonly string[]> = {
  greeting: [
    'Hello. Ask me anything about the indexed documents and I will answer from them, with a link to the source for every claim. If the collection does not cover something, I will say so rather than guess.',
    'Hi. I answer from an indexed set of documents and cite the ones I used. Ask about the SDK, the build pipeline, the ad network specifications, or the project reports.',
    'Hello. Every answer here comes from the indexed documents, with the source attached. Ask a question and I will show you where the answer came from.',
    'Hi there. Ask about anything in the collection and I will quote the document it came from. If it is not in there, I will tell you that instead of guessing.',
  ],
  thanks: [
    'You are welcome. Ask another question whenever you need one.',
    'Any time. There is more in the collection if you want to keep going.',
    'Glad it helped. Ask again whenever something comes up.',
    'You are welcome. I am here if you need anything else from the documents.',
    'No trouble at all. Ask away whenever you like.',
  ],
  farewell: [
    'Goodbye. Your conversations are kept, so you can pick this up where you left it.',
    'See you. This conversation stays here for when you come back.',
    'Take care. Everything you asked is saved in the list beside you.',
    'Goodbye for now. Nothing is lost; the conversation will be here.',
  ],
};

/**
 * One of them, varied by the message rather than at random.
 *
 * A hash of the text, so the same message gives the same reply and the interface does not
 * change under a reader who scrolls back up. Two different thank yous still differ.
 */
export function smallTalkReply(kind: SmallTalk, text: string): string {
  const options = REPLIES[kind];

  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 100_000;
  }

  return options[hash % options.length] as string;
}

/** Every reply, for tests that check what they promise. */
export const SMALL_TALK_REPLIES = REPLIES;
