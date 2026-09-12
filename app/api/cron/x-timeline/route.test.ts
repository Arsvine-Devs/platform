import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { syncAllMock } = vi.hoisted(() => ({ syncAllMock: vi.fn() }));

vi.mock('../../../../lib/x-timeline-sync', () => ({
  syncAllConfiguredXWorkspaces: syncAllMock,
}));

import { GET } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  syncAllMock.mockReset();
  syncAllMock.mockResolvedValue([]);
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe('X timeline cron route', () => {
  it('rejects requests without Vercel Cron authorization', async () => {
    const response = await GET(new Request('https://admin.example.com/api/cron/x-timeline') as never);
    expect(response.status).toBe(401);
    expect(syncAllMock).not.toHaveBeenCalled();
  });

  it('runs one low-frequency page per configured workspace', async () => {
    syncAllMock.mockResolvedValue([{ userId: 'owner', result: { fetched: 1, created: 1, updated: 0, changed: true, hasMore: false, revalidated: { revalidated: true } } }]);
    const response = await GET(new Request('https://admin.example.com/api/cron/x-timeline', { headers: { authorization: 'Bearer cron-secret' } }) as never);
    expect(response.status).toBe(200);
    expect(syncAllMock).toHaveBeenCalledWith({ mode: 'recent', maxPages: 1 });
    expect(await response.json()).toMatchObject({ ok: true, processed: 1, changed: 1, failed: 0 });
  });
});
