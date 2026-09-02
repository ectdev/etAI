import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CHAT_LOCATION_COOKIE, resolveChatLocation } from '@/lib/chat-location';
import { listConversations } from '@/lib/conversations';
import { requireRoleForPage } from '@/lib/session';

/**
 * /chat, which is a signpost rather than a screen.
 *
 * It sends you to wherever you were: the conversation you were reading, or a new one if
 * that is what you had open. Leaving for the dashboard and coming back to an empty
 * composer looked like the conversation had been lost, which is the whole reason this
 * redirect exists rather than rendering the chat here.
 *
 * The check runs here rather than being left to the middleware, which only looks for a
 * cookie and cannot see a role.
 */
export default async function ChatPage() {
  const session = await requireRoleForPage(['admin', 'user'], '/chat');

  const [store, conversations] = await Promise.all([cookies(), listConversations(session.user.id)]);

  const location = resolveChatLocation(
    store.get(CHAT_LOCATION_COOKIE)?.value,
    conversations.map((row) => row.id),
  );

  redirect(location.kind === 'new' ? '/chat/new' : `/chat/${location.id}`);
}
