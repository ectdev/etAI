/**
 * Where /chat should land when nobody named a conversation.
 *
 * Leaving the chat for the dashboard and coming back used to give an empty screen, which
 * reads as having lost the conversation even though it was stored. So the last place is
 * remembered, and "last place" includes having deliberately started a new conversation:
 * somebody who pressed New chat and then looked at the dashboard should come back to the
 * empty composer, not to the conversation before it.
 *
 * A cookie rather than a column, because it is a property of this browser and not of the
 * account. The same person on a laptop and a phone is in a different place in each, and a
 * column would make one of them follow the other around.
 */

export const CHAT_LOCATION_COOKIE = 'etai_chat';

/** The value written when somebody starts a new conversation. */
export const NEW_CHAT = 'new';

/** Thirty days. Long enough to survive a weekend, short enough to expire. */
export const CHAT_LOCATION_MAX_AGE = 60 * 60 * 24 * 30;

export type ChatLocation = { kind: 'new' } | { kind: 'conversation'; id: string };

/** A uuid, which is what the conversation id is. Anything else is treated as unset. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the remembered location, falling back to the most recent conversation.
 *
 * The cookie is not trusted for anything but where to look. It names a conversation, and
 * whether that conversation may be read is decided by the query that loads it, which
 * takes the owner. A cookie edited by hand points at a conversation that does not come
 * back, and the caller lands on a new one.
 */
export function resolveChatLocation(
  cookieValue: string | undefined,
  /** The ids this user actually has, newest first. */
  ownedNewestFirst: readonly string[],
): ChatLocation {
  if (cookieValue === NEW_CHAT) return { kind: 'new' };

  /**
   * The cookie has to still name one of this user's conversations.
   *
   * Checking the shape is not enough, and a browser walk is what showed it: deleting a
   * conversation leaves the cookie pointing at it, and /chat then redirected to a bare
   * 404. The same happens to anyone who deletes a conversation in one tab and returns to
   * /chat in another, and to anyone whose cookie outlives the row.
   *
   * It also means the cookie cannot select somebody else's conversation, because the list
   * it is checked against was fetched for this user.
   */
  if (cookieValue && UUID.test(cookieValue) && ownedNewestFirst.includes(cookieValue)) {
    return { kind: 'conversation', id: cookieValue };
  }

  // No usable cookie, which is a first visit, a cleared browser, or a conversation that
  // has since gone. The most recent one is a better landing than an empty screen.
  const [mostRecent] = ownedNewestFirst;
  if (mostRecent) return { kind: 'conversation', id: mostRecent };

  return { kind: 'new' };
}
