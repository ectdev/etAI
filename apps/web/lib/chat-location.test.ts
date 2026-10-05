import { describe, expect, it } from 'vitest';
import { NEW_CHAT, resolveChatLocation } from './chat-location';

/**
 * Where /chat lands, as a plain function of a cookie and the newest conversation.
 *
 * The behaviour is small and the cases are all "which of two things wins", which is
 * exactly the kind of thing that is obvious while writing it and wrong a week later. It
 * is a pure function so that the rule can be read without starting a server.
 */

const ID = '11111111-2222-4333-8444-555555555555';
const NEWEST = '99999999-8888-4777-8666-555555555555';

const OWNED = [NEWEST, ID];

describe('coming back to /chat', () => {
  it('returns to the conversation that was open', () => {
    expect(resolveChatLocation(ID, OWNED)).toEqual({ kind: 'conversation', id: ID });
  });

  it('returns to a new conversation when that is where you were', () => {
    /**
     * The case the whole cookie exists for. Somebody presses New chat, goes to the
     * dashboard, comes back. Without this they land in the conversation they had
     * deliberately left, and the empty composer they were looking at is gone.
     */
    expect(resolveChatLocation(NEW_CHAT, OWNED)).toEqual({ kind: 'new' });
  });

  it('falls back to the most recent conversation on a first visit', () => {
    // No cookie: a new browser, or one that was cleared. An empty screen would read as
    // having lost everything, so the newest conversation is the better guess.
    expect(resolveChatLocation(undefined, OWNED)).toEqual({ kind: 'conversation', id: NEWEST });
  });

  it('lands on a new conversation when there is nothing to return to', () => {
    expect(resolveChatLocation(undefined, [])).toEqual({ kind: 'new' });
  });

  it('ignores a conversation that has since been deleted', () => {
    /**
     * Found by walking the app rather than by reading it. Deleting a conversation leaves
     * the cookie naming it, and /chat then redirected straight to a bare 404. The same
     * happens across two tabs, and to any cookie that outlives its row.
     */
    const gone = '77777777-6666-4555-8444-333333333333';

    expect(resolveChatLocation(gone, OWNED)).toEqual({ kind: 'conversation', id: NEWEST });
    expect(resolveChatLocation(gone, [])).toEqual({ kind: 'new' });
  });

  it('will not open a conversation this user does not own', () => {
    // The list is fetched for the signed-in user, so a cookie naming somebody else's
    // conversation cannot select it. The page behind it checks ownership again.
    const someoneElse = '88888888-7777-4666-8555-444444444444';

    expect(resolveChatLocation(someoneElse, OWNED)).toEqual({ kind: 'conversation', id: NEWEST });
  });

  it('ignores a cookie that is not a conversation id', () => {
    /**
     * The cookie is readable and writable in the browser, so it arrives as whatever
     * somebody typed. It is only ever used to choose a URL, and whether that conversation
     * may be read is decided by the query that loads it, but a value that is not an id at
     * all should not become a path segment.
     */
    for (const value of ['../../etc/passwd', 'null', '1 OR 1=1', '<script>', '']) {
      expect(resolveChatLocation(value, OWNED), `accepted ${value}`).toEqual({
        kind: 'conversation',
        id: NEWEST,
      });
    }
  });
});
