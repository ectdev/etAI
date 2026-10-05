/**
 * The Content-Security-Policy every page is served with.
 *
 * Strict in production: scripts and styles run only when they carry the nonce minted for
 * this request, so markup that reaches the page some other way cannot execute. That is
 * the second line behind the first. Answers are rendered without `innerHTML` and the
 * corpus is treated as untrusted, and this is what still holds if one of those is ever
 * got wrong. Framing is refused, plugins are refused, and forms may only post here.
 *
 * Development relaxes exactly what Next.js documents it needs: `eval` for React's
 * reconstructed stacks, a WebSocket for hot reload, and inline styles for the error
 * overlay. A nonce is left out of the development style list on purpose, because a
 * browser ignores `'unsafe-inline'` whenever a nonce is present.
 *
 * Built as a pure function so the policy can be asserted without a server.
 */
export interface PolicyContext {
  nonce: string;
  development: boolean;
  /** Only an HTTPS origin may ask the browser to upgrade requests, or local HTTP breaks. */
  https: boolean;
}

/** A nonce goes inside quotes in a header, so anything but base64 is refused. */
const NONCE = /^[A-Za-z0-9+/]{16,}={0,2}$/;

export function buildContentSecurityPolicy({ nonce, development, https }: PolicyContext): string {
  if (!NONCE.test(nonce)) {
    throw new Error('A CSP nonce must be at least 16 base64 characters.');
  }

  const directives: Array<[string, ...string[]]> = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", ...(development ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'"],
    ['connect-src', "'self'", ...(development ? ['ws:'] : [])],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];

  if (https) directives.push(['upgrade-insecure-requests']);

  return directives.map((parts) => parts.join(' ')).join('; ');
}

/** 128 random bits, base64, which is what the CSP specification asks a nonce to carry. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
