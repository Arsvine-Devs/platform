import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError, adminRequest } from './client';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

describe('adminRequest', () => {
  it('adds JSON, no-store, and CSRF request metadata', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { saved: true } }));

    await expect(
      adminRequest<{ saved: boolean }>('/api/control/example', {
        method: 'PUT',
        csrfToken: 'csrf-token',
        body: { value: 'example' },
      }),
    ).resolves.toEqual({ saved: true });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
    expect(init?.body).toBe(JSON.stringify({ value: 'example' }));
  });

  it('supports successful responses without a data property', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      adminRequest<void>('/api/control/example', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('accepts an empty successful response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      adminRequest<void>('/api/control/example', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('preserves server error code and retry metadata', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, error: { code: 'reauth_required', message: '请重新认证。' } },
        401,
        { 'Retry-After': '3' },
      ),
    );

    const result = adminRequest('/api/control/example');
    await expect(result).rejects.toBeInstanceOf(AdminApiError);
    await expect(result).rejects.toMatchObject({
      status: 401,
      code: 'reauth_required',
      retryAfterMs: 3000,
      message: '请重新认证。',
    });
  });

  it.each([403, 409, 429])('preserves an HTTP %s API error', async (status) => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, error: { code: `status_${status}`, message: `error-${status}` } },
        status,
        status === 429 ? { 'Retry-After': '2' } : undefined,
      ),
    );

    await expect(adminRequest('/api/control/example')).rejects.toMatchObject({
      status,
      code: `status_${status}`,
      message: `error-${status}`,
      ...(status === 429 ? { retryAfterMs: 2000 } : {}),
    });
  });

  it('returns a safe error for non-JSON responses and network failures', async () => {
    fetchMock.mockResolvedValue(new Response('upstream failure', { status: 502 }));
    await expect(adminRequest('/api/control/example')).rejects.toMatchObject({
      status: 502,
      message: '请求失败（HTTP 502）。',
    });

    fetchMock.mockRejectedValue(new Error('connection reset'));
    await expect(adminRequest('/api/control/example')).rejects.toMatchObject({
      status: 0,
      message: '网络请求失败，请检查连接后重试。',
    });
  });
});
