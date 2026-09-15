import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret');
  vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');
  vi.stubEnv('AUTH_OIDC_CLIENT_SECRET', 'client-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /health/ready', () => {
  it('returns ready when the BFF configuration is complete', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', service: 'console' });
  });

  it('reports missing required configuration without exposing values', async () => {
    vi.stubEnv('SESSION_SECRET', '');

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not_ready',
      service: 'console',
      reason: 'missing_configuration:SESSION_SECRET',
    });
  });
});
