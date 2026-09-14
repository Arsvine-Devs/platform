import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchXTimelinePage, XApiError } from './x-timeline';
import type { XTimelineConfig } from './workspace-context';

const config: XTimelineConfig = {
  syncMethod: 'api',
  enabled: true,
  bearerToken: 'test-bearer',
  targetUserId: '2244994945',
  targetUsername: 'XDevelopers',
  includeReplies: true,
  includeRetweets: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('X_API_BASE_URL', 'https://api.x.com/2');
  vi.stubEnv('X_WEB_BASE_URL', 'https://x.com');
});

describe('X timeline provider', () => {
  it('normalizes a User Posts response and preserves pagination metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: '1346889436626259968',
            text: 'A post from X.',
            author_id: '2244994945',
            created_at: '2026-09-12T00:00:00.000Z',
            lang: 'en',
          },
        ],
        includes: { users: [{ id: '2244994945', username: 'XDevelopers' }] },
        meta: { newest_id: '1346889436626259968', next_token: 'next-page' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchXTimelinePage(config, { sinceId: '1346889436626259000' });

    expect(result).toEqual({
      posts: [
        {
          externalId: '1346889436626259968',
          createdAt: '2026-09-12T00:00:00.000Z',
          content: 'A post from X.',
          lang: 'en',
          authorId: '2244994945',
          authorUsername: 'XDevelopers',
          canonicalUrl: 'https://x.com/XDevelopers/status/1346889436626259968',
        },
      ],
      nextCursor: 'next-page',
      newestId: '1346889436626259968',
      oldestId: undefined,
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('since_id=1346889436626259000');
    expect(requestUrl).toContain('exclude=retweets');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-bearer' },
    });
  });

  it('surfaces paid API failures without exposing the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        detail: 'Insufficient credits',
        errors: [{ type: 'credits_exhausted' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchXTimelinePage(config)).rejects.toMatchObject({
      status: 402,
      code: 'credits_exhausted',
      message: 'Insufficient credits',
    } satisfies Partial<XApiError>);
    await expect(fetchXTimelinePage(config)).rejects.not.toThrow('test-bearer');
  });
});
