import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * A first pass that keeps signed-out visitors off private pages.
 *
 * This deliberately only looks for the presence of a session cookie. Middleware
 * runs on every matched request, so reaching the database here would add a query to
 * each page load, and it cannot check a role without doing so.
 *
 * That makes this a redirect for convenience, not a security boundary. The real
 * check happens in the page or the handler, which reads the session and calls
 * requireRole. A forged cookie gets past this and then fails there.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
