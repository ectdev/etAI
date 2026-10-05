'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        // The landing rather than the sign-in form: somebody who just signed out has not
        // asked to sign in again, and the landing is the page that says what this is.
        router.replace('/');
        router.refresh();
      }}
      className="btn btn-secondary"
    >
      {pending ? 'Signing out' : 'Sign out'}
    </button>
  );
}
