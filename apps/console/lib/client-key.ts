import type { NextRequest } from 'next/server';
import { readEnv } from '@arsvine/env';

// Honor forwarded IPs only when the gateway replaces the header. Requests without
// a trusted address share the unknown-client rate limit.
function isTruthyEnv(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isProxyTrusted() {
  return isTruthyEnv(readEnv('TRUST_PROXY'));
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

  return 'unknown';
}
