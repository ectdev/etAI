import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { auth } from './auth';
import {
  deleteConversation,
  getConversation,
  listConversations,
  recordTurn,
  titleFrom,
} from './conversations';

/**
 * Conversations, and who can read them.
 *
 * The ownership cases are the reason this file exists. Everything else here is a list and
 * a title, and getting those wrong is visible; getting ownership wrong is not, because
 * the version with no check behaves identically for the person who owns the row. It only
 * misbehaves for a stranger, and a stranger is exactly who never turns up in manual
 * testing.
 *
 * Requires the database: docker compose up -d && pnpm db:migrate
 */

const OWNER = { email: 'conversation-owner@etai.test', name: 'Owner' } as const;
const STRANGER = { email: 'conversation-stranger@etai.test', name: 'Stranger' } as const;

let ownerId = '';
let strangerId = '';

const turn = (question: string) => ({
  question,
  answer: 'The limit is 5 MB [1].',
  coverage: 'full' as const,
  gap: null,
  citations: [
    {
      sourceNumber: 1,
      documentId: 'doc-1',
      documentPath: 'network-specs-applovin.md',
      title: 'AppLovin network specification',
      quote: 'Maximum file size: 5 MB.',
    },
  ],
  sources: [
    {
      documentId: 'doc-1',
      path: 'network-specs-applovin.md',
      title: 'AppLovin network specification',
      headingPath: null,
      docType: 'reference',
      temporalDate: null,
      isDeprecated: false,
      supersededByPath: null,
    },
  ],
});

async function makeUser(account: { email: string; name: string }): Promise<string> {
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(account.email);
  if (existing?.user) await ctx.internalAdapter.deleteUser(existing.user.id);

  const created = await ctx.internalAdapter.createUser({
    email: account.email,
    name: account.name,
    emailVerified: true,
    role: 'user',
  });

  return created.id;
}

beforeEach(async () => {
  ownerId = await makeUser(OWNER);
  strangerId = await makeUser(STRANGER);
});

afterAll(async () => {
  const ctx = await auth.$context;
  for (const account of [OWNER, STRANGER]) {
    const found = await ctx.internalAdapter.findUserByEmail(account.email);
    // Conversations cascade with the user, which is also what keeps this suite from
    // leaving rows behind for the next run to count.
    if (found?.user) await ctx.internalAdapter.deleteUser(found.user.id);
  }
  await closeDb();
});

describe('storing a turn', () => {
  it('starts a conversation on the first question and reuses it on the second', async () => {
    const first = await recordTurn(ownerId, null, turn('What is the AppLovin size limit?'));
    const second = await recordTurn(ownerId, first, turn('And for Unity?'));

    expect(second, 'the second question started a new conversation').toBe(first);

    const found = await getConversation(first, ownerId);
    expect(found?.turns).toHaveLength(2);
  });

  it('keeps the turns in the order they were asked', async () => {
    const id = await recordTurn(ownerId, null, turn('First question'));
    await recordTurn(ownerId, id, turn('Second question'));
    await recordTurn(ownerId, id, turn('Third question'));

    const found = await getConversation(id, ownerId);

    expect(found?.turns.map((t) => t.question)).toEqual([
      'First question',
      'Second question',
      'Third question',
    ]);
  });

  it('stores the citations and sources as they were given', async () => {
    // A history that loses the citations is a history of unsupported claims.
    const id = await recordTurn(ownerId, null, turn('What is the AppLovin size limit?'));
    const found = await getConversation(id, ownerId);

    expect(found?.turns[0]?.citations[0]?.quote).toBe('Maximum file size: 5 MB.');
    expect(found?.turns[0]?.sources[0]?.path).toBe('network-specs-applovin.md');
  });
});

describe('editing a question', () => {
  it('replaces that turn and everything after it', async () => {
    const id = await recordTurn(ownerId, null, turn('First question'));
    await recordTurn(ownerId, id, turn('Second question'));
    await recordTurn(ownerId, id, turn('Third question'));

    // The second question, edited. Two and three go; one stays.
    await recordTurn(ownerId, id, turn('Second question, reworded'), 1);

    const found = await getConversation(id, ownerId);
    expect(found?.turns.map((t) => t.question)).toEqual([
      'First question',
      'Second question, reworded',
    ]);
  });

  it('replaces the whole conversation when the first question is edited', async () => {
    const id = await recordTurn(ownerId, null, turn('First question'));
    await recordTurn(ownerId, id, turn('Second question'));

    await recordTurn(ownerId, id, turn('First question, reworded'), 0);

    const found = await getConversation(id, ownerId);
    expect(found?.turns.map((t) => t.question)).toEqual(['First question, reworded']);
  });

  it('leaves the conversation alone when nothing is being replaced', async () => {
    // The premise. If recordTurn always truncated, both assertions above would pass and
    // an ordinary follow-up would silently delete the question before it.
    const id = await recordTurn(ownerId, null, turn('First question'));
    await recordTurn(ownerId, id, turn('Second question'));

    const found = await getConversation(id, ownerId);
    expect(found?.turns).toHaveLength(2);
  });

  it('will not truncate another user conversation', async () => {
    // The id is treated as absent for a stranger, so their edit starts a conversation of
    // their own rather than deleting turns from somebody else's.
    const theirs = await recordTurn(ownerId, null, turn('First question'));
    await recordTurn(ownerId, theirs, turn('Second question'));

    await recordTurn(strangerId, theirs, turn('Trying to rewind it'), 0);

    const owned = await getConversation(theirs, ownerId);
    expect(owned?.turns, 'a stranger truncated somebody else conversation').toHaveLength(2);
  });
});

describe('who can read a conversation', () => {
  it('does not return another user conversation, by id', async () => {
    const id = await recordTurn(ownerId, null, turn('Something private'));

    // A valid session, a real id, and the wrong owner. This is the request a crafted
    // client makes, and the only thing standing in its way is the owner in the query.
    expect(await getConversation(id, strangerId), 'a stranger read it').toBeNull();

    // The premise. If getConversation returned null for everybody, the line above would
    // pass while proving nothing.
    expect(await getConversation(id, ownerId), 'the owner could not read it').not.toBeNull();
  });

  it('does not list another user conversations', async () => {
    await recordTurn(ownerId, null, turn('Something private'));

    expect(await listConversations(strangerId)).toEqual([]);
    expect(await listConversations(ownerId)).toHaveLength(1);
  });

  it('will not append to another user conversation, and starts a fresh one instead', async () => {
    /**
     * The write side of the same rule, and the one that is easier to get wrong: a check
     * that only guards reading still lets a stranger put a turn into your history.
     *
     * The id is treated as absent rather than refused, so the stranger's question lands
     * in a conversation of their own.
     */
    const theirs = await recordTurn(ownerId, null, turn('Something private'));
    const mine = await recordTurn(strangerId, theirs, turn('Trying to write into it'));

    expect(mine, 'a stranger wrote into somebody else conversation').not.toBe(theirs);

    const owned = await getConversation(theirs, ownerId);
    expect(owned?.turns, 'the owner conversation grew a turn they did not ask').toHaveLength(1);
  });

  it('lists most recently used first, not most recently created', async () => {
    const older = await recordTurn(ownerId, null, turn('Asked first'));
    const newer = await recordTurn(ownerId, null, turn('Asked second'));

    // Returning to the older conversation should bring it back to the top.
    await recordTurn(ownerId, older, turn('Back to the first one'));

    const listed = await listConversations(ownerId);
    expect(listed.map((row) => row.id)).toEqual([older, newer]);
  });
});

describe('deleting a conversation', () => {
  it('removes it and its turns for the owner', async () => {
    const id = await recordTurn(ownerId, null, turn('Something to delete'));
    await recordTurn(ownerId, id, turn('A second turn'));

    expect(await deleteConversation(id, ownerId)).toBe(true);
    expect(await getConversation(id, ownerId)).toBeNull();
    expect(await listConversations(ownerId)).toEqual([]);
  });

  it('will not delete another user conversation', async () => {
    /**
     * The case that matters. A delete written as "find it, then check the owner" behaves
     * identically for the owner and hands a stranger a way to destroy somebody else's
     * history, and nothing about the interface would show it.
     */
    const id = await recordTurn(ownerId, null, turn('Not yours to delete'));

    expect(await deleteConversation(id, strangerId), 'a stranger deleted it').toBe(false);
    expect(await getConversation(id, ownerId), 'it was deleted anyway').not.toBeNull();
  });

  it('reports false for an id that does not exist, the same as one that is not yours', async () => {
    // Same answer either way, so a stranger cannot use the result to learn which ids
    // are real.
    expect(await deleteConversation('11111111-2222-4333-8444-555555555555', ownerId)).toBe(false);
  });
});

describe('the title', () => {
  it('is the question when it is short enough', () => {
    expect(titleFrom('What is the AppLovin size limit?')).toBe('What is the AppLovin size limit?');
  });

  it('cuts a long question at a word boundary', () => {
    const long =
      'What is the maximum file size for an AppLovin playable and does it differ by region?';
    const title = titleFrom(long);

    expect(title.length).toBeLessThanOrEqual(63);
    expect(title.endsWith('...')).toBe(true);
    // Cut between words, so the title does not end mid-word.
    expect(title.replace('...', '').trimEnd()).toBe(title.replace('...', ''));
  });

  it('collapses the whitespace a pasted question arrives with', () => {
    expect(titleFrom('  What   is\n\nthe limit? ')).toBe('What is the limit?');
  });
});
