import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getSessionFromRequestMock, verifyCsrfMock } = vi.hoisted(() => ({
  getSessionFromRequestMock: vi.fn(),
  verifyCsrfMock: vi.fn(),
}));

vi.mock('./auth', () => ({
  getSessionFromRequest: getSessionFromRequestMock,
  verifyCsrf: verifyCsrfMock,
}));

import { callControlApi, isControlApiSuccess } from './control-api';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_BASE_URL', 'https://api.example.com');
  vi.stubEnv('AUTH_OIDC_RESOURCE', 'https://resource.example.com');
  getSessionFromRequestMock.mockResolvedValue({
    authSource: 'oidc',
    accessToken: 'access-token',
  });
  verifyCsrfMock.mockReturnValue(true);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ me: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  getSessionFromRequestMock.mockReset();
  verifyCsrfMock.mockReset();
});

describe('callControlApi', () => {
  it('calls the API base origin rather than the OAuth resource value', async () => {
    const result = await callControlApi(
      new NextRequest('https://console.example.com/api/control/me'),
      '/v1/me',
    );

    expect(isControlApiSuccess(result)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.example.com/v1/me');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
  });
});
