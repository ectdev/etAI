import Link from 'next/link';

/**
 * A conversation that is not there.
 *
 * Reached by an id that was deleted, never existed, or belongs to somebody else. All
 * three land here and say the same thing, which is deliberate: distinguishing them would
 * tell a stranger which ids are real.
 *
 * /chat itself no longer sends anybody here, since it checks the remembered id against
 * the conversations this user actually has. This is for a link that was pasted or
 * bookmarked.
 */
export default function ConversationNotFound() {
  return (
    <div className="et-dash">
      <div className="et-dash-inner et-notfound">
        <div className="card-kicker">Conversation</div>
        <h3>This conversation is not here.</h3>
        <p className="text-muted">
          It may have been deleted, or the link may belong to a different account. Your other
          conversations are unaffected.
        </p>
        <Link href="/chat" className="btn btn-primary et-notfound-action">
          Back to the chat
        </Link>
      </div>
    </div>
  );
}
