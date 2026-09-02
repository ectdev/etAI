'use client';

import { useEffect } from 'react';
import { CHAT_LOCATION_COOKIE, CHAT_LOCATION_MAX_AGE } from '@/lib/chat-location';

/**
 * Records which conversation this browser is looking at.
 *
 * A client component because a server component may not set a cookie. Next.js refuses it
 * at runtime with "Cookies can only be modified in a Server Action or Route Handler",
 * which is a rule no test here caught and the first page load did.
 *
 * A route handler would work too and would cost a request per page view to write one
 * value that only this browser reads. The cookie is a hint about where to look, never a
 * permission: whether that conversation can be opened is decided by the query that loads
 * it, which takes the owner.
 */
export function RememberChatLocation({ value }: { value: string }) {
  useEffect(() => {
    document.cookie = `${CHAT_LOCATION_COOKIE}=${value}; path=/; max-age=${CHAT_LOCATION_MAX_AGE}; samesite=lax`;
  }, [value]);

  return null;
}
