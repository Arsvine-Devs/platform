import { Redis } from 'ioredis';
import { readEnv } from '@arsvine/env';

let client: Redis | undefined;

export function getConsoleRedis() {
  const url = readEnv('REDIS_URL');
  if (!url) return null;
  if (!client) {
    client = new Redis(url, {
      keyPrefix: readEnv('REDIS_KEY_PREFIX') ?? 'console:production:',
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => {
      console.error('[console] Valkey connection unavailable');
    });
  }
  return client;
}
