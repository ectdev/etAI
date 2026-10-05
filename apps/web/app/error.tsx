'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { BrandMark } from '@/components/brand-mark';

/**
 * What a page shows when rendering it fails unexpectedly.
 *
 * The rest of the application is unaffected: this replaces the page that failed, and the
 * other pages still work. The reference is the digest Next.js gives a server error, which
 * matches the line in the server log without putting the error itself in front of the
 * reader, since an error message can carry details that do not belong there.
 */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="et-auth">
      <div className="et-auth-inner">
        <div className="et-auth-brand">
          <BrandMark size={26} className="et-auth-mark" />
          <span className="et-auth-name">etAI</span>
        </div>
        <div className="card elev-sm et-auth-panel et-notfound" role="alert">
          <div className="card-kicker">Something went wrong</div>
          <h3>This page could not be shown.</h3>
          <p className="text-muted">
            The rest of the application is working. Trying again usually helps when the cause was a
            moment of bad luck rather than a fault.
            {error.digest ? ` Reference ${error.digest}.` : ''}
          </p>
          <div className="et-landing-actions et-notfound-action">
            <button type="button" className="btn btn-primary" onClick={() => retry()}>
              Try again
            </button>
            <Link href="/" className="btn btn-secondary">
              Go to the start
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
