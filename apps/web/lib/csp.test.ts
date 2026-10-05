import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSignedInArea, proxy } from '../proxy';
import { buildContentSecurityPolicy, createNonce } from './csp';

/**
 * The page policy, and the proxy that attaches it.
 *
 * The policy is a pure function, so what production allows can be read off a string
 * rather than inferred from a browser that stayed quiet. The proxy is called with real
 * `NextRequest` objects, which is the same thing Next.js hands it, so the redirect and
 * the nonce plumbing are checked without a server.
 */

const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name!, values];
    }),
  );
}

describe('buildContentSecurityPolicy', () => {
  it('lets only nonced scripts and styles run in production', () => {
    const policy = directives(
      buildContentSecurityPolicy({ nonce: NONCE, development: false, https: false }),
    );

    expect(policy.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(policy.get('style-src')).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
  });

  it('never allows inline code or eval in production', () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, development: false, https: true });

    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('ws:');
    expect(policy).not.toMatch(/\*/);
  });

  it('relaxes exactly what development needs, and nothing else', () => {
    const production = directives(
      buildContentSecurityPolicy({ nonce: NONCE, development: false, https: false }),
    );
    const development = directives(
      buildContentSecurityPolicy({ nonce: NONCE, development: true, https: false }),
    );

    expect(development.get('script-src')).toEqual([
      ...production.get('script-src')!,
      "'unsafe-eval'",
    ]);
    // A nonce next to 'unsafe-inline' makes the browser ignore 'unsafe-inline'.
    expect(development.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(development.get('connect-src')).toEqual(["'self'", 'ws:']);

    const untouched = [...production.keys()].filter(
      (name) => !['script-src', 'style-src', 'connect-src'].includes(name),
    );
    for (const name of untouched) expect(development.get(name), name).toEqual(production.get(name));
  });

  it('asks for an upgrade only on an HTTPS origin', () => {
    expect(buildContentSecurityPolicy({ nonce: NONCE, development: false, https: true })).toMatch(
      /; upgrade-insecure-requests$/,
    );
    expect(
      buildContentSecurityPolicy({ nonce: NONCE, development: false, https: false }),
    ).not.toContain('upgrade');
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc123'],
    ['a quote that would close the source', `${NONCE}' 'unsafe-inline`],
    ['a semicolon that would start a directive', `${NONCE}; script-src *`],
    ['whitespace', 'AAECAwQFBgcICQoL DA0ODw=='],
    ['too much padding', 'AAECAwQFBgcICQoLDA0ODw==='],
    ['url-safe alphabet', 'AAECAwQFBgcICQoLDA0OD-_'],
  ])('refuses a nonce that is %s', (_, nonce) => {
    expect(() => buildContentSecurityPolicy({ nonce, development: false, https: false })).toThrow(
      /nonce/,
    );
  });

  it('separates directives so a parser reads them one by one', () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, development: false, https: true });

    expect(policy.split('; ').every((directive) => /^[a-z-]+( \S+)*$/.test(directive))).toBe(true);
    expect(policy).not.toMatch(/;;|; ;|;$/);
  });
});

describe('createNonce', () => {
  it('produces 128 bits of base64 the policy accepts', () => {
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
    expect(() =>
      buildContentSecurityPolicy({ nonce, development: false, https: false }),
    ).not.toThrow();
  });

  it('does not repeat', () => {
    const nonces = new Set(Array.from({ length: 1000 }, createNonce));

    expect(nonces.size).toBe(1000);
  });
});

describe('isSignedInArea', () => {
  it.each([
    ['/dashboard', true],
    ['/dashboard/', true],
    ['/dashboard/documents', true],
    ['/dashboard/users/abc', true],
    ['/dashboards', false],
    ['/dashboard-old', false],
    ['/', false],
    ['/chat', false],
    ['/sign-in', false],
    ['', false],
  ])('%s is %s', (path, guarded) => {
    expect(isSignedInArea(path)).toBe(guarded);
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  function request(path: string, cookie?: string, origin = 'http://localhost:3000'): NextRequest {
    return new NextRequest(new URL(path, origin), cookie ? { headers: { cookie } } : undefined);
  }

  function nonceOf(policy: string | null): string {
    const match = /'nonce-([^']+)'/.exec(policy ?? '');
    if (!match) throw new Error(`no nonce in ${policy}`);
    return match[1]!;
  }

  it('sends a signed-out visitor from the dashboard to sign-in and remembers where they were', () => {
    const response = proxy(request('/dashboard/documents'));

    expect(response.status).toBe(307);
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('next')).toBe('/dashboard/documents');
  });

  it('lets a visitor with a session cookie through, leaving the real check to the page', () => {
    const response = proxy(request('/dashboard', 'better-auth.session_token=forged.value'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('accepts the cookie under the name production gives it', () => {
    const response = proxy(
      request(
        '/dashboard',
        '__Secure-better-auth.session_token=forged.value',
        'https://etai.example',
      ),
    );

    expect(response.status).toBe(200);
  });

  it('does not redirect public pages', () => {
    for (const path of ['/', '/sign-in', '/chat', '/dashboards']) {
      expect(proxy(request(path)).status, path).toBe(200);
    }
  });

  it('puts the same fresh nonce on the response policy and on the request Next.js renders', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const first = proxy(request('/'));
    const second = proxy(request('/'));

    const policy = first.headers.get('content-security-policy');
    const nonce = nonceOf(policy);
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(nonceOf(second.headers.get('content-security-policy'))).not.toBe(nonce);
    expect(policy).not.toContain('unsafe-eval');
  });

  it('uses the development policy only in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(proxy(request('/')).headers.get('content-security-policy')).toContain("'unsafe-eval'");
  });

  it('asks for HTTPS upgrades only when it was reached over HTTPS', () => {
    expect(
      proxy(request('/', undefined, 'https://etai.example')).headers.get('content-security-policy'),
    ).toContain('upgrade-insecure-requests');
    expect(proxy(request('/')).headers.get('content-security-policy')).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('carries no policy on a redirect, which has no page to protect', () => {
    expect(proxy(request('/dashboard')).headers.get('content-security-policy')).toBeNull();
  });
});
