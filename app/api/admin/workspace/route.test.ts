import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getWorkspaceConfigMock, getWorkspaceSummaryMock, saveWorkspaceConfigMock } = vi.hoisted(
  () => ({
    getWorkspaceConfigMock: vi.fn(),
    getWorkspaceSummaryMock: vi.fn(),
    saveWorkspaceConfigMock: vi.fn(),
  }),
);

vi.mock('../../../../lib/accounts', () => ({
  getWorkspaceConfig: getWorkspaceConfigMock,
  getWorkspaceSummary: getWorkspaceSummaryMock,
  saveWorkspaceConfig: saveWorkspaceConfigMock,
}));

vi.mock('../../../../lib/auth', () => ({
  getSessionFromRequest: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  verifyCsrf: vi.fn().mockReturnValue(true),
}));

import { PUT } from './route';

function request(body: Record<string, unknown>) {
  return new Request('https://admin.example.com/api/admin/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const github = { owner: 'owner', repo: 'repo', branch: 'main', token: 'github-token' };

beforeEach(() => {
  getWorkspaceConfigMock.mockRejectedValue(new Error('not configured'));
  getWorkspaceSummaryMock.mockResolvedValue({});
  saveWorkspaceConfigMock.mockReset();
});

describe('workspace X configuration', () => {
  it('saves target identity without requiring an API token', async () => {
    const response = await PUT(
      request({
        github,
        x: {
          syncMethod: 'none',
          targetUserId: '2244994945',
          targetUsername: 'XDevelopers',
          bearerToken: '',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(saveWorkspaceConfigMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        x: expect.objectContaining({
          syncMethod: 'none',
          targetUserId: '2244994945',
          targetUsername: 'XDevelopers',
          bearerToken: '',
        }),
      }),
    );
  });

  it('requires a token only when the API method is selected', async () => {
    const response = await PUT(
      request({
        github,
        x: {
          syncMethod: 'api',
          targetUserId: '2244994945',
          targetUsername: 'XDevelopers',
          bearerToken: '',
        },
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: { message: 'Please configure an X bearer token.' },
    });
    expect(saveWorkspaceConfigMock).not.toHaveBeenCalled();
  });
});
