'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { changePasswordSchema, MIN_PASSWORD_LENGTH } from '@etai/shared';

/**
 * Changing your own password, in a dialog rather than on a page.
 *
 * A page would mean navigating away from whatever you were doing, and what people are
 * doing here is holding a conversation. Coming back to an empty chat because you went to
 * change a password is a worse bug than the one this feature fixes, and a dialog cannot
 * cause it: nothing is unmounted and no route changes.
 *
 * `<dialog>` with `showModal()` rather than a div with a high z-index. It brings the
 * focus trap, Escape, inertness of the page behind it and `::backdrop` with it, all of
 * which would otherwise be written by hand and got wrong.
 *
 * The same schema runs here and at the endpoint. Here it saves a round trip on a typo;
 * there it runs because anything arriving over HTTP has to be checked whatever the form
 * did. The current password is the one field this cannot check locally, since the hash is
 * on the server, so that error always comes back from the request.
 */

type Errors = Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>;

interface Props {
  email: string;
  open: boolean;
  onClose: () => void;
}

export function PasswordDialog({ email, open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    // showModal() rather than the `open` attribute. The attribute renders the dialog
    // without the backdrop, the focus trap or the top layer, which is most of the reason
    // for using a dialog at all.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function reset() {
    setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setErrors({});
    setFailure(null);
    setStatus('idle');
  }

  const field = (name: keyof typeof values) => ({
    name,
    type: 'password' as const,
    className: 'input',
    value: values[name],
    // Browsers offer to save the new one and to fill the old one. Naming them correctly
    // is the difference between a password manager helping and it filling the wrong box.
    autoComplete:
      name === 'currentPassword' ? ('current-password' as const) : ('new-password' as const),
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name]
      ? `${titleId}-${name === 'currentPassword' ? 'current' : name === 'newPassword' ? 'new' : 'repeat'}-error`
      : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [name]: event.target.value }));
      setStatus('idle');
    },
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    const parsed = changePasswordSchema.safeParse(values);

    if (!parsed.success) {
      const found: Errors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (typeof path === 'string' && !(path in found)) {
          found[path as keyof Errors] = issue.message;
        }
      }
      setErrors(found);
      return;
    }

    setErrors({});
    setStatus('saving');

    const response = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });

    if (response.ok) {
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setStatus('saved');
      return;
    }

    setStatus('idle');

    const body: unknown = await response.json().catch(() => null);
    const issues =
      body && typeof body === 'object' && 'details' in body
        ? (body as { details?: { issues?: Array<{ path: string; message: string }> } }).details
            ?.issues
        : undefined;

    if (issues?.length) {
      const found: Errors = {};
      for (const issue of issues) {
        if (!(issue.path in found)) found[issue.path as keyof Errors] = issue.message;
      }
      setErrors(found);
      return;
    }

    setFailure('The password could not be changed. Try again.');
  }

  return (
    <dialog
      ref={dialog}
      className="et-dialog"
      aria-labelledby={titleId}
      // Escape and the backdrop both close it, and both have to put the state back or
      // the next open would render a dialog React thinks is shut.
      onClose={() => {
        onClose();
        reset();
      }}
      onClick={(event) => {
        // The dialog element fills the viewport, so a click landing on it rather than
        // on the panel inside is a click on the backdrop.
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="et-dialog-panel">
        <header className="et-dialog-head">
          <h6 id={titleId}>Change password</h6>
          <button
            type="button"
            className="et-dialog-close"
            aria-label="Close"
            onClick={() => onClose()}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <p className="text-muted et-dialog-lead">
          Signed in as {email}. Changing your password signs out every other session on this
          account.
        </p>

        <form className="et-password-form" onSubmit={submit} noValidate>
          <div className="et-field">
            <label htmlFor={`${titleId}-current`}>Current password</label>
            <input {...field('currentPassword')} id={`${titleId}-current`} />
            {errors.currentPassword ? (
              <p className="et-field-error" id={`${titleId}-current-error`}>
                {errors.currentPassword}
              </p>
            ) : null}
          </div>

          <div className="et-field">
            <label htmlFor={`${titleId}-new`}>New password</label>
            <input {...field('newPassword')} id={`${titleId}-new`} />
            {errors.newPassword ? (
              <p className="et-field-error" id={`${titleId}-new-error`}>
                {errors.newPassword}
              </p>
            ) : (
              <p className="text-muted et-field-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
            )}
          </div>

          <div className="et-field">
            <label htmlFor={`${titleId}-repeat`}>Repeat new password</label>
            <input {...field('confirmPassword')} id={`${titleId}-repeat`} />
            {errors.confirmPassword ? (
              <p className="et-field-error" id={`${titleId}-repeat-error`}>
                {errors.confirmPassword}
              </p>
            ) : null}
          </div>

          {failure ? (
            <p className="et-field-error" role="alert">
              {failure}
            </p>
          ) : null}

          {/* Announced as well as shown, since the fields clear themselves and a
                sighted reader takes the empty form as the confirmation. */}
          <p
            className="et-dialog-status"
            role="status"
            data-saved={status === 'saved' || undefined}
          >
            {status === 'saved' ? 'Password changed. Other sessions were signed out.' : ''}
          </p>

          <div className="et-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onClose()}>
              {status === 'saved' ? 'Done' : 'Cancel'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
              {status === 'saving' ? 'Changing' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
