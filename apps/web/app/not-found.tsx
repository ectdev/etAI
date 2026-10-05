import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';

/** Any address that is not a page, laid out like the other screens outside the app. */
export default function NotFound() {
  return (
    <main className="et-auth">
      <div className="et-auth-inner">
        <div className="et-auth-brand">
          <BrandMark size={26} className="et-auth-mark" />
          <span className="et-auth-name">etAI</span>
        </div>
        <div className="card elev-sm et-auth-panel et-notfound">
          <div className="card-kicker">Not found</div>
          <h3>There is no page at this address.</h3>
          <p className="text-muted">It may have moved, or the link may have a typo in it.</p>
          <Link href="/" className="btn btn-primary et-notfound-action">
            Go to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
