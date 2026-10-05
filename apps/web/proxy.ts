import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, createNonce } from '@/lib/csp';

/**
 * Runs before every page: mints this request's CSP nonce, and keeps signed-out visitors
 * off the dashboard.
 *
 * Named `proxy` because Next.js 16 renamed the `middleware` convention; the old name
 * still worked and was deprecated.
 *
 * The redirect only looks for the presence of a session cookie. Reaching the database
 * here would add a query to every page load, and a role cannot be checked without one.
 * So it is a convenience, not a security boundary: the page and the handler read the
 * session and check the role, and a forged cookie gets past this only to fail there.
 *
 * The nonce goes on the request as well as the response, because that is where Next.js
 * reads it from to stamp its own scripts and styles during rendering.
 */
export function proxy(request: NextRequest) {
  if (isSignedInArea(request.nextUrl.pathname) && !getSessionCookie(request)) {
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

/** `/dashboard` and everything under it, but not a path that merely starts the same way. */
export function isSignedInArea(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

export const config = {
  matcher: [
    {
      // Pages only. API responses are JSON and static assets carry no markup, and a
      // prefetch is answered by the page it prefetches.
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
