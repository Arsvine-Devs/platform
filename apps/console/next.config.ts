import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';
const analyticsScriptOrigin = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_ORIGIN?.trim();
const analyticsConnectOrigin = process.env.NEXT_PUBLIC_ANALYTICS_CONNECT_ORIGIN?.trim();

// Admin console only — no third-party iframes, no inline analytics. The CSP
// keeps `'unsafe-inline'` for styles because Next.js injects critical CSS
// inline; everything else is locked down. `'unsafe-eval'` is allowed for
// scripts in development because Turbopack/Next-devtools rely on it; in
// production we drop it. `connect-src` keeps `'self'` only — admin API
// Browser calls go through same-origin Console BFF routes; the BFF calls the API service.
const cspDirectives = [
  "default-src 'self'",
  [
    'script-src',
    "'self'",
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    ...(analyticsScriptOrigin ? [analyticsScriptOrigin] : []),
  ].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  ['connect-src', "'self'", ...(analyticsConnectOrigin ? [analyticsConnectOrigin] : [])].join(' '),
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
  agentRules: false,
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
