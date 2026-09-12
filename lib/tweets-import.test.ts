import { beforeEach, describe, expect, it, vi } from 'vitest';

const { files, getFileMock, listTweetMonthPathsMock, putFileMock } = vi.hoisted(() => {
  const files = new Map<string, { sha: string; content: string }>();
  const getFileMock = vi.fn(async (path: string) => files.get(path) ?? null);
  const listTweetMonthPathsMock = vi.fn(async () =>
    [...files.keys()].filter((path) => /^tweets\/\d{4}-\d{2}\.json$/.test(path)),
  );
  const putFileMock = vi.fn(async (input: { path: string; content: string }) => {
    files.set(input.path, { sha: `sha-${input.path}`, content: input.content });
    return { content: { sha: `sha-${input.path}` } };
  });
  return { files, getFileMock, listTweetMonthPathsMock, putFileMock };
});

vi.mock('./github', () => ({
  deleteFile: vi.fn(),
  getContentRepoInfo: vi.fn(() => ({ owner: 'owner', repo: 'repo', branch: 'main', url: 'https://github.com/owner/repo' })),
  getFile: getFileMock,
  GitHubError: class GitHubError extends Error { status = 409; },
  listTweetMonthPaths: listTweetMonthPathsMock,
  putFile: putFileMock,
}));

import { mergeImportedTweets } from './tweets';

beforeEach(() => {
  files.clear();
  files.set('tweets/index.json', { sha: 'sha-index', content: '[]' });
  getFileMock.mockClear();
  listTweetMonthPathsMock.mockClear();
  putFileMock.mockClear();
});

describe('X tweet import merge', () => {
  it('creates a stable internal tweet and updates it idempotently', async () => {
    const post = {
      externalId: '1346889436626259968',
      createdAt: '2026-09-12T00:00:00.000Z',
      content: 'First version',
      lang: 'en' as const,
      authorId: '2244994945',
      authorUsername: 'XDevelopers',
      canonicalUrl: 'https://x.com/XDevelopers/status/1346889436626259968',
    };

    await expect(mergeImportedTweets([post], '2026-09-12T08:00:00.000Z')).resolves.toMatchObject({
      created: 1,
      updated: 0,
      changed: true,
    });

    const firstMonth = JSON.parse(files.get('tweets/2026-09.json')!.content) as Array<Record<string, unknown>>;
    expect(firstMonth[0]).toMatchObject({
      id: '20260912-001',
      content: 'First version',
      origin: { provider: 'x', externalId: post.externalId },
    });

    await expect(
      mergeImportedTweets([{ ...post, content: 'Edited version' }], '2026-09-12T09:00:00.000Z'),
    ).resolves.toMatchObject({ created: 0, updated: 1, changed: true });
    const updatedMonth = JSON.parse(files.get('tweets/2026-09.json')!.content) as Array<Record<string, unknown>>;
    expect(updatedMonth[0]).toMatchObject({ id: '20260912-001', content: 'Edited version' });
  });
});
