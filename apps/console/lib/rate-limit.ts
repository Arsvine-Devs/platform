import { createClient } from 'redis';
import { isDevelopmentBypassEnabled } from './development-preview';

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
const REDIS_URL = process.env.REDIS_URL?.trim();

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let redisConnection: Promise<RedisClient> | null = null;

function getRedis() {
  if (!REDIS_URL) return null;
  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (error) => {
      console.error('[rate-limit] redis client error', error);
    });
  }
  return redisClient;
}

async function getConnectedRedis() {
  const redis = getRedis();
  if (!redis) return null;
  if (!redis.isOpen) {
    if (!redisConnection) {
      redisConnection = redis
        .connect()
        .then(() => redis)
        .catch((error) => {
          redisConnection = null;
          throw error;
        });
    }
    await redisConnection;
  }
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
  redis: RedisClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<LimiterDecision> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const count = await redis.incr(key);

  let ttlSeconds = windowSeconds;
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  } else {
    const pttl = Number(await redis.pTTL(key));
    if (pttl < 0) {
      await redis.expire(key, windowSeconds);
    } else {
      ttlSeconds = Math.max(1, Math.ceil(pttl / 1000));
    }
  }

  const retryAfterMs = ttlSeconds * 1000;
  if (count > limit) {
    return { ok: false, remaining: 0, retryAfterMs };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - count),
    retryAfterMs,
  };
}

export function isRateLimitPersistent() {
  return Boolean(REDIS_URL);
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  if (isDevelopmentBypassEnabled()) {
    return { ok: true, remaining: limit, retryAfterMs: 0 };
  }
  const redis = await getConnectedRedis();
  if (!redis) {
    return localEnforceRateLimit(key, limit, windowMs);
  }

  try {
    return await redisEnforceRateLimit(redis, key, limit, windowMs);
  } catch (error) {
    console.error('[rate-limit] redis enforce failed; falling back to local map', error);
    return localEnforceRateLimit(key, limit, windowMs);
  }
}
