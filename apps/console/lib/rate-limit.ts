import type { Redis } from 'ioredis';
import { getConsoleRedis } from './console-redis';

type Bucket = {
  count: number;
  resetAt: number;
};

type LimiterDecision = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

const buckets = new Map<string, Bucket>();
const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

function localEnforceRateLimit(key: string, limit: number, windowMs: number): LimiterDecision {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: windowMs };
  }

  if (current.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, current.resetAt - now),
    };
  }

  current.count += 1;
  buckets.set(key, current);
  return {
    ok: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterMs: Math.max(0, current.resetAt - now),
  };
}

async function redisEnforceRateLimit(
  store: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<LimiterDecision> {
  const [count, retryAfterMs] = (await store.eval(
    INCREMENT_WINDOW,
    1,
    `rate:${key}`,
    windowMs,
  )) as [number, number];
  return count > limit
    ? { ok: false, remaining: 0, retryAfterMs }
    : { ok: true, remaining: Math.max(0, limit - count), retryAfterMs };
}

export function isRateLimitPersistent() {
  return Boolean(getConsoleRedis());
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const store = getConsoleRedis();
  if (!store) return localEnforceRateLimit(key, limit, windowMs);

  try {
    return await redisEnforceRateLimit(store, key, limit, windowMs);
  } catch {
    return { ok: false, remaining: 0, retryAfterMs: windowMs };
  }
}
