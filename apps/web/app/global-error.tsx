'use client';

import './globals.css';
import { useEffect } from 'react';
import { BrandMark } from '@/components/brand-mark';

/**
 * The last boundary, for a failure in the root layout itself.
 *
 * It replaces the whole document, so it brings its own `<html>` and `<body>` and imports
 * the stylesheet the layout would have. A plain stylesheet is allowed by the page policy;
 * inline styles are not, which is why there are none here.
 */
export default function GlobalError({
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
    <html lang="en">
      <body>
        <title>Something went wrong · etAI</title>
        <main className="et-auth">
          <div className="et-auth-inner">
            <div className="et-auth-brand">
              <BrandMark size={26} className="et-auth-mark" />
              <span className="et-auth-name">etAI</span>
            </div>
            <div className="card elev-sm et-auth-panel et-notfound" role="alert">
              <div className="card-kicker">Something went wrong</div>
              <h3>etAI could not start this page.</h3>
              <p className="text-muted">
                Trying again usually helps when the cause was temporary.
                {error.digest ? ` Reference ${error.digest}.` : ''}
              </p>
              <button
                type="button"
                className="btn btn-primary et-notfound-action"
                onClick={() => retry()}
              >
                Try again
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
