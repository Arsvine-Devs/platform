import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /health/live', () => {
  it('reports process liveness without checking external dependencies', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'live', service: 'console' });
  });
});
