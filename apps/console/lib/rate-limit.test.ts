import { describe, expect, it, vi } from 'vitest';
import { enforceRateLimit, isRateLimitPersistent } from './rate-limit';

describe('rate limiting local fallback', () => {
  it('enforces the configured limit inside the window', async () => {
    const key = `login:test:${Math.random()}`;
    const first = await enforceRateLimit(key, 2, 60_000);
    const second = await enforceRateLimit(key, 2, 60_000);
    const third = await enforceRateLimit(key, 2, 60_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window elapses', async () => {
    const now = vi.spyOn(Date, 'now');
    const key = `login:reset:${Math.random()}`;

    now.mockReturnValue(1_000);
    await enforceRateLimit(key, 1, 100);
    const blocked = await enforceRateLimit(key, 1, 100);

    now.mockReturnValue(1_200);
    const reset = await enforceRateLimit(key, 1, 100);

    expect(blocked.ok).toBe(false);
    expect(reset.ok).toBe(true);

    now.mockRestore();
  });

  it('reports local mode when Redis is not configured', () => {
    expect(isRateLimitPersistent()).toBe(false);
  });
});
