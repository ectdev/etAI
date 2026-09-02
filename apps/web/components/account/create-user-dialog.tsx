'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createUserSchema, MIN_PASSWORD_LENGTH, type Role } from '@etai/shared';

/**
 * Creating an account, for an administrator.
 *
 * There is no sign-up form on purpose, which left one way to add a colleague: edit the
 * seed script and run it. This is that, from the interface.
 *
 * The role is chosen here and fixed at creation. Nothing anywhere lets an account change
 * its own role, and the endpoint checks the administrator role again, so hiding this
 * behind a condition is tidiness rather than the security boundary.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

type Field = 'email' | 'name' | 'password' | 'role';
type Errors = Partial<Record<Field, string>>;

export function CreateUserDialog({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [values, setValues] = useState({
    email: '',
    name: '',
    password: '',
    role: 'user' as Role,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [created, setCreated] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function reset() {
    setValues({ email: '', name: '', password: '', role: 'user' });
    setErrors({});
    setCreated(null);
    setFailure(null);
    setStatus('idle');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setCreated(null);

    const parsed = createUserSchema.safeParse(values);

    if (!parsed.success) {
      const found: Errors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (typeof path === 'string' && !(path in found)) found[path as Field] = issue.message;
      }
      setErrors(found);
      return;
    }

    setErrors({});
    setStatus('saving');

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });

    setStatus('idle');

    if (response.ok) {
      setCreated(parsed.data.email);
      setValues({ email: '', name: '', password: '', role: 'user' });
      return;
    }

    const body: unknown = await response.json().catch(() => null);
    const issues =
      body && typeof body === 'object' && 'details' in body
        ? (body as { details?: { issues?: Array<{ path: string; message: string }> } }).details
            ?.issues
        : undefined;

    if (issues?.length) {
      const found: Errors = {};
      for (const issue of issues) {
        if (!(issue.path in found)) found[issue.path as Field] = issue.message;
      }
      setErrors(found);
      return;
    }

    setFailure('The account could not be created. Try again.');
  }

  const text = (name: 'email' | 'name' | 'password') => ({
    id: `${titleId}-${name}`,
    name,
    className: 'input',
    value: values[name],
    type:
      name === 'password'
        ? ('password' as const)
        : name === 'email'
          ? ('email' as const)
          : ('text' as const),
    autoComplete: 'off' as const,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `${titleId}-${name}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [name]: event.target.value }));
      setCreated(null);
    },
  });

  return (
    <dialog
      ref={dialog}
      className="et-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        reset();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="et-dialog-panel">
        <header className="et-dialog-head">
          <h6 id={titleId}>Add a user</h6>
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
          There is no sign-up form, so accounts are created here. Give the person their password
          directly; they can change it from this same menu.
        </p>

        <form className="et-password-form" onSubmit={submit} noValidate>
          <div className="et-field">
            <label htmlFor={`${titleId}-email`}>Email</label>
            <input {...text('email')} />
            {errors.email ? (
              <p className="et-field-error" id={`${titleId}-email-error`}>
                {errors.email}
              </p>
            ) : null}
          </div>

          <div className="et-field">
            <label htmlFor={`${titleId}-name`}>Name</label>
            <input {...text('name')} />
            {errors.name ? (
              <p className="et-field-error" id={`${titleId}-name-error`}>
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="et-field">
            <label htmlFor={`${titleId}-password`}>Password</label>
            <input {...text('password')} />
            {errors.password ? (
              <p className="et-field-error" id={`${titleId}-password-error`}>
                {errors.password}
              </p>
            ) : (
              <p className="text-muted et-field-hint">
                At least {MIN_PASSWORD_LENGTH} characters. Shown once, here, and never again.
              </p>
            )}
          </div>

          <div className="et-field">
            <label htmlFor={`${titleId}-role`}>Role</label>
            <select
              id={`${titleId}-role`}
              className="input"
              value={values.role}
              onChange={(event) => setValues((v) => ({ ...v, role: event.target.value as Role }))}
            >
              <option value="user">User, can ask questions</option>
              <option value="admin">Admin, can also see the dashboard</option>
            </select>
            <p className="text-muted et-field-hint">
              Fixed when the account is created. Nothing lets an account change its own role.
            </p>
          </div>

          {failure ? (
            <p className="et-field-error" role="alert">
              {failure}
            </p>
          ) : null}

          <p className="et-dialog-status" role="status" data-saved={created ? true : undefined}>
            {created ? `${created} can now sign in.` : ''}
          </p>

          <div className="et-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onClose()}>
              {created ? 'Done' : 'Cancel'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
              {status === 'saving' ? 'Creating' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
