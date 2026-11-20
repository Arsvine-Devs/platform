import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';

// Admin console only — no third-party iframes, no inline analytics. The CSP
// keeps `'unsafe-inline'` for styles because Next.js injects critical CSS
// inline; everything else is locked down. `'unsafe-eval'` is allowed for
// scripts in development because Turbopack/Next-devtools rely on it; in
// production we drop it. `connect-src` keeps `'self'` only — admin API
// Browser calls go through same-origin Console BFF routes; the BFF calls the API service.
const cspDirectives = [
  "default-src 'self'",
  ['script-src', "'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
];

if (isProduction) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig: NextConfig = {
  agentRules: true,
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  cacheMaxMemorySize: 16 * 1024 * 1024,
  logging: { browserToTerminal: true },
  experimental: { isrFlushToDisk: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
