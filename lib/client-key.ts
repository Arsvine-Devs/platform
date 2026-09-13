import type { NextRequest } from 'next/server';

// Only honor X-Forwarded-For when an explicit `TRUST_PROXY=1` flag is set —
// otherwise an unauthenticated client can rotate the header and bypass any
// rate limit keyed on it. When trust is off we fall back to the socket IP
// surfaced by Next.js (`request.ip`); if that is also missing we collapse all
// callers into a single `unknown` bucket so brute-force still hits the limit.
function isTruthyEnv(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isProxyTrusted() {
  return isTruthyEnv(process.env.TRUST_PROXY);
}

function firstHopFromForwardedFor(value: string | null) {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

export function getClientKey(request: NextRequest) {
  if (isProxyTrusted()) {
    const forwarded = firstHopFromForwardedFor(request.headers.get('x-forwarded-for'));
    if (forwarded) return forwarded;
  }

  // `request.ip` is populated by Next.js at the runtime layer (Vercel/Edge)
  // and is not attacker-controlled.
  const ip = (request as unknown as { ip?: string }).ip;
  if (ip && ip.length > 0) return ip;

  return 'unknown';
}
