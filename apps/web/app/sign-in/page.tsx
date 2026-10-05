import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { SignInForm } from './sign-in-form';
import { BrandMark } from '@/components/brand-mark';

export const metadata = { title: 'Sign in to etAI' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Someone already signed in has no reason to see this page.
  if (await getSession()) {
    redirect(next && next.startsWith('/') ? next : '/');
  }

  return (
    <main className="et-auth">
      <div className="et-auth-inner">
        <div className="et-auth-brand">
          <BrandMark size={26} className="et-auth-mark" />
          <span className="et-auth-name">etAI</span>
        </div>

        <div>
          <h1>Sign in</h1>
          <p className="et-auth-lead text-muted">
            Accounts are created by an administrator, so there is no sign-up form.
          </p>
        </div>

        <SignInForm redirectTo={next} />
      </div>
    </main>
  );
}
