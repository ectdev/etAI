'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { signInSchema } from '@etai/shared';
import { signIn } from '@/lib/auth-client';

/**
 * Only ever tells the visitor that the pair was wrong, never which half.
 * Distinguishing them would turn the form into a way to find out which email
 * addresses have accounts.
 */
const WRONG_CREDENTIALS = 'That email and password combination does not match an account.';

export function SignInForm({ redirectTo }: { redirectTo?: string | undefined }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
      return;
    }

    setPending(true);

    const { error: signInError } = await signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (signInError) {
      setPending(false);
      if (signInError.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else if (signInError.status === 403) {
        setError('This account has been suspended.');
      } else if (signInError.status && signInError.status >= 500) {
        setError('The server did not respond. Please try again.');
      } else {
        setError(WRONG_CREDENTIALS);
      }
      return;
    }

    const target = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/';
    router.replace(target);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="et-auth-form" noValidate>
      <label className="et-auth-field">
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className="input"
        />
      </label>

      <label className="et-auth-field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          className="input"
        />
      </label>

      {error ? (
        <p role="alert" className="et-auth-error">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary btn-block">
        {pending ? 'Signing in' : 'Sign in'}
      </button>
    </form>
  );
}
