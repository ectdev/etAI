import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ChatScreen } from '@/components/chat/chat-screen';
import { HistoryRail } from '@/components/chat/history-rail';
import { RememberChatLocation } from '@/components/chat/remember-location';
import { NEW_CHAT } from '@/lib/chat-location';
import type { Turn } from '@/lib/chat-types';
import { getConversation, listConversations } from '@/lib/conversations';
import { requireRoleForPage } from '@/lib/session';

/**
 * One conversation, or a new one at /chat/new.
 *
 * The conversation is loaded here rather than fetched by the browser, so the ownership
 * check runs on the server before any of it exists as markup. `getConversation` takes the
 * owner and puts it in the query, so somebody else's id returns nothing and this renders
 * a 404: the same answer an id that was never real would get.
 */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRoleForPage(['admin', 'user'], `/chat/${id}`);

  const isNew = id === NEW_CHAT;

  const [conversations, opened] = await Promise.all([
    listConversations(session.user.id),
    isNew ? Promise.resolve(null) : getConversation(id, session.user.id),
  ]);

  // Not this user's, or not a conversation at all. Both give the same answer, so an id
  // that exists cannot be told apart from one that does not.
  if (!isNew && !opened) notFound();

  /**
   * Stored turns become answered turns.
   *
   * They are rendered from what was stored rather than re-answered. Asking again would
   * give a different answer once the corpus changes, and a history that rewrites itself
   * is worse than no history.
   */
  const initialTurns: Turn[] = (opened?.turns ?? []).map((turn) => ({
    id: turn.id,
    question: turn.question,
    phase: 'answered',
    sources: turn.sources,
    retrievalMs: null,
    answer: {
      answer: turn.answer,
      coverage: turn.coverage,
      gap: turn.gap,
      citations: turn.citations,
      sources: turn.sources,
    },
    error: null,
  }));

  return (
    <AppShell
      title={opened ? opened.title : 'Chat'}
      user={{ email: session.user.email, role: session.user.role ?? 'user' }}
      showDashboard={session.user.role === 'admin'}
      rail={
        <HistoryRail
          conversations={conversations}
          currentId={opened?.id ?? null}
          placement="rail"
        />
      }
      drawer={
        <HistoryRail
          conversations={conversations}
          currentId={opened?.id ?? null}
          placement="drawer"
        />
      }
    >
      {/* Remembered so that leaving and coming back through /chat lands here again,
          including when "here" is a new conversation somebody deliberately opened. */}
      <RememberChatLocation value={isNew ? NEW_CHAT : id} />

      <ChatScreen conversationId={opened?.id ?? null} initialTurns={initialTurns} />
    </AppShell>
  );
}
