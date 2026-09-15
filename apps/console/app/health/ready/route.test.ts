import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret');
  vi.stubEnv('AUTH_OIDC_ISSUER', 'https://auth.example.com');
  vi.stubEnv('AUTH_OIDC_RESOURCE', 'https://api.example.com');
  vi.stubEnv('API_BASE_URL', 'https://api.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /health/ready', () => {
  it('returns ready after the required database check succeeds', async () => {
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
