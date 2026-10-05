'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { PasswordDialog } from './password-dialog';
import { CreateUserDialog } from './create-user-dialog';

/**
 * The account menu, top right.
 *
 * Change password used to be a button sitting in the header beside sign out, which put a
 * rarely used action at the same weight as the navigation. It belongs behind the thing
 * that identifies you, which is where people look for it.
 *
 * Top right rather than bottom left because the Next.js development indicator sits in the
 * bottom left corner and would cover it.
 *
 * The native `popover` attribute rather than a click-outside listener: light dismiss,
 * Escape, and the top layer come from the platform, which is the same argument as using
 * `<dialog>` for the forms it opens.
 */

interface Props {
  email: string;
  role: string;
}

export function AccountMenu({ email, role }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();
  const [signingOut, setSigningOut] = useState(false);
  const [changing, setChanging] = useState(false);
  const [creating, setCreating] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const initial = email.slice(0, 1).toUpperCase();

  /**
   * Closes it on the two events that can strand a fixed-position popover.
   *
   * Light dismiss and Escape come from the platform and cover a click on the page. They
   * do not cover a route change, and they do not cover scrolling: the menu is positioned
   * against the viewport, so a scrolled page leaves it floating over content it is no
   * longer attached to. Both are cheap to handle and neither depends on which page is
   * underneath.
   */
  useEffect(() => {
    menu.current?.hidePopover();
  }, [pathname]);

  useEffect(() => {
    const close = () => menu.current?.hidePopover();

    // Capture, because the pages here scroll an inner container rather than the window,
    // and a scroll event on a child does not bubble.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  /**
   * Closes the menu before opening a dialog.
   *
   * Both live in the top layer, and a popover opened first stays above a modal opened
   * after it, so the menu would sit on top of the form it just opened.
   */
  const openThen = (open: () => void) => () => {
    menu.current?.hidePopover();
    open();
  };

  return (
    <>
      <button
        type="button"
        className="et-account-trigger"
        popoverTarget={menuId}
        aria-label={`Account menu for ${email}`}
      >
        <span className="et-avatar et-avatar-sm" aria-hidden="true">
          {initial}
        </span>
        <span className="et-account-trigger-text">
          <span className="et-account-trigger-email">{email}</span>
          <span className="text-muted et-account-trigger-role">{role}</span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div ref={menu} id={menuId} className="et-menu" popover="auto">
        <div className="et-menu-head">
          <span className="et-menu-email">{email}</span>
          <span className="text-muted et-menu-role">Signed in as {role}</span>
        </div>

        <button type="button" className="et-menu-item" onClick={openThen(() => setChanging(true))}>
          Change password
        </button>

        {/* Administrators only, and the endpoint behind it checks the role again. This
            hides a control; it does not enforce anything. */}
        {role === 'admin' ? (
          <button
            type="button"
            className="et-menu-item"
            onClick={openThen(() => setCreating(true))}
          >
            Add a user
          </button>
        ) : null}

        <div className="et-menu-divider" />

        <button
          type="button"
          className="et-menu-item et-menu-item-quiet"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            menu.current?.hidePopover();
            await signOut();
            // The landing rather than the sign-in form: somebody who just signed out has not
            // asked to sign in again, and the landing is the page that says what this is.
            router.replace('/');
            router.refresh();
          }}
        >
          {signingOut ? 'Signing out' : 'Sign out'}
        </button>
      </div>

      <PasswordDialog email={email} open={changing} onClose={() => setChanging(false)} />

      {role === 'admin' ? (
        <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      ) : null}
    </>
  );
}
