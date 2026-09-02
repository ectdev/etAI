import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LandingExample } from '@/components/landing-example';
import { SignOutButton } from '@/components/sign-out-button';
import { getSession } from '@/lib/session';

/**
 * The first screen anybody opens, which has to be true about the system behind it.
 *
 * It once told visitors that the chat page and the dashboard were not built, days after
 * both were, which is why `staleness.test.ts` now fails when a page contradicts a route
 * that exists.
 *
 * Signed out it shows the product rather than describing it: a real answer, rendered by
 * the same components the chat page uses. Signed in it is short, because somebody with a
 * session wants the application rather than an argument for it.
 */
export default async function HomePage() {
  const session = await getSession();

  /**
   * A signed-in regular user goes straight to the chat.
   *
   * There used to be a panel here offering to open it, and telling them the dashboard was
   * for administrators. Both sentences were true and neither was useful: there is one
   * thing a regular user came to do, and a screen listing a place they cannot go is worse
   * than not mentioning it.
   *
   * An administrator keeps a landing, because there really are two destinations.
   */
  if (session && session.user.role !== 'admin') redirect('/chat');

  if (session) {
    return (
      <main className="et-auth">
        <div className="et-auth-inner et-auth-wide">
          <div className="et-auth-brand">
            <span className="et-auth-mark">p</span>
            <span className="et-auth-name">etAI</span>
          </div>

          <div className="card elev-sm et-auth-panel">
            <p className="et-auth-note">
              Signed in as <strong>{session.user.email}</strong>, with the{' '}
              <strong>{session.user.role}</strong> role.
            </p>

            <div className="et-landing-actions">
              <Link href="/chat" className="btn btn-primary">
                Open the chat
              </Link>
              <Link href="/dashboard" className="btn btn-secondary">
                Open the dashboard
              </Link>
              <SignOutButton />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="et-landing">
      <div className="et-landing-inner">
        <div className="et-landing-brand et-rise et-rise-0">
          <span className="et-auth-mark">p</span>
          <span className="et-auth-name">etAI</span>
        </div>

        <div className="et-landing-columns">
          <div className="et-landing-copy">
            <h1 className="et-rise et-rise-1">
              Ask a collection of documents, and see where the answer came from.
            </h1>

            <div className="et-landing-claims et-rise et-rise-2">
              <p>
                <strong>Every answer cites the documents behind it.</strong> Each claim carries the
                number of the document it came from, and that number opens the document at the
                passage it used.
              </p>
              <p>
                <strong>When the collection does not cover a question, it says so.</strong> Refusing
                is a first-class answer here rather than a failure, and it names what is missing
                instead of guessing.
              </p>
            </div>

            <div className="et-landing-enter et-rise et-rise-3">
              <Link href="/sign-in" className="btn btn-primary">
                Sign in
              </Link>
              <p className="et-auth-note text-muted">
                Accounts are created by an administrator. There is no public registration.
              </p>
            </div>
          </div>

          <div className="et-landing-demo et-rise et-rise-4">
            <LandingExample />
          </div>
        </div>
      </div>
    </main>
  );
}
