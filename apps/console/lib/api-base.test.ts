import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiBaseUrl } from './api-base';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getApiBaseUrl', () => {
  it('uses the API origin independently of the OAuth resource', () => {
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');
    vi.stubEnv('AUTH_OIDC_RESOURCE', 'https://resource.example.com');

    expect(getApiBaseUrl().origin).toBe('https://api.example.com');
  });

  it('rejects a path-bearing API base URL', () => {
    vi.stubEnv('API_BASE_URL', 'https://api.example.com/v1');

    expect(() => getApiBaseUrl()).toThrow('API_BASE_URL must identify an origin without a path.');
  });
});
