'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AccountMenu } from '@/components/account/account-menu';

/**
 * The frame every signed-in screen sits in.
 *
 * Three widths, matching the design: a labelled rail on desktop, an icon rail on tablet,
 * and no rail at all on a phone, where the navigation moves into the header. The
 * breakpoints are the design's own, 1120 and 700, and they are CSS rather than a
 * measured window width so the first paint is right and there is no resize listener.
 */

interface Props {
  title: string;
  user: { email: string; role: string };
  /** Admin only. A regular user has no dashboard to be shown a link to. */
  showDashboard: boolean;
  /**
   * The conversation list, for the chat pages only.
   *
   * It lives in the rail rather than in a column of its own, under the navigation, because
   * a second vertical strip beside the first read as two separate ideas of what a sidebar
   * is. Absent on the dashboard, which has no conversations to list.
   */
  rail?: ReactNode;
  /**
   * The same list again, for the widths where the rail is icons only or gone.
   *
   * Opened from a button in the header and slid in from the left, which is what every
   * chat application on a phone does and therefore where people look for it.
   */
  drawer?: ReactNode;
  children: ReactNode;
}

const RAIL = {
  chat: <path d="M4 5.5h16v10H9.5L4.5 19.5V5.5z" />,
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
};

function NavIcon({ name }: { name: keyof typeof RAIL }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: 'none' }}
      aria-hidden="true"
    >
      {RAIL[name]}
    </svg>
  );
}

export function AppShell({ title, user, showDashboard, rail, drawer, children }: Props) {
  const pathname = usePathname();
  const drawerId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);

  // A route change means a conversation was chosen, so the drawer has done its job.
  useEffect(() => {
    drawerRef.current?.hidePopover();
  }, [pathname]);
  const links = [
    { href: '/chat', label: 'Chat', icon: 'chat' as const, show: true },
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' as const, show: showDashboard },
  ].filter((link) => link.show);

  const railLink = (href: string, label: string, icon: keyof typeof RAIL) => {
    const current = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={current ? 'page' : undefined}
        className="et-rail-link"
        data-current={current || undefined}
      >
        <NavIcon name={icon} />
        <span className="et-rail-label">{label}</span>
      </Link>
    );
  };

  return (
    <div className="et-frame">
      <aside className="et-rail">
        <div className="et-brand">
          <span className="et-brand-mark" aria-hidden="true">
            p
          </span>
          <span className="et-rail-label et-brand-name">etAI</span>
        </div>

        <nav className="et-rail-nav" aria-label="Sections">
          {links.map((link) => railLink(link.href, link.label, link.icon))}
        </nav>

        {rail}
      </aside>

      <div className="et-main">
        <header className="et-header">
          {drawer ? (
            <>
              <button
                type="button"
                className="et-drawer-open"
                popoverTarget={drawerId}
                aria-label="Conversations"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
                </svg>
              </button>

              <div ref={drawerRef} id={drawerId} className="et-drawer" popover="auto">
                {drawer}
              </div>
            </>
          ) : null}

          <h6 className="et-header-title">{title}</h6>

          <div className="et-header-nav">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="et-header-link"
                data-current={pathname === link.href || undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="et-header-user">
            <AccountMenu email={user.email} role={user.role} />
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
