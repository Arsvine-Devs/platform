import { Redis } from '@upstash/redis';

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
const REST_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
let redis: Redis | null = null;

function getRedis() {
  if (!REST_URL || !REST_TOKEN) return null;
  redis ??= new Redis({ url: REST_URL, token: REST_TOKEN });
  return redis;
}

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
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const count = await store.incr(key);
  let ttlSeconds = windowSeconds;
  if (count === 1) {
    await store.expire(key, windowSeconds);
  } else {
    const pttl = await store.pttl(key);
    if (pttl < 0) {
      await store.expire(key, windowSeconds);
    } else {
      ttlSeconds = Math.max(1, Math.ceil(pttl / 1000));
    }
  }

  const retryAfterMs = ttlSeconds * 1000;
  return count > limit
    ? { ok: false, remaining: 0, retryAfterMs }
    : { ok: true, remaining: Math.max(0, limit - count), retryAfterMs };
}

export function isRateLimitPersistent() {
  return Boolean(REST_URL && REST_TOKEN);
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const store = getRedis();
  if (!store) return localEnforceRateLimit(key, limit, windowMs);

  try {
    return await redisEnforceRateLimit(store, key, limit, windowMs);
  } catch (error) {
    console.error('[rate-limit] Redis enforcement failed; using local limiter', error);
    return localEnforceRateLimit(key, limit, windowMs);
  }
}
