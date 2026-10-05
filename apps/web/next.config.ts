import type { NextConfig } from 'next';

/**
 * Security headers are set here rather than in the proxy so that they apply to every
 * response, including static assets and error pages the proxy does not see. The
 * Content-Security-Policy is the exception: it carries a nonce minted per request, so it
 * is set in proxy.ts.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Naming the framework in every response tells a scanner which advisories to try first.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
