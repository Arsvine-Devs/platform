import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  deploy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: mocks.session,
  verifyCsrf: mocks.csrf,
}));
vi.mock('@/lib/web-ops', () => ({ requestDeployment: mocks.deploy }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));

import { POST } from './route';

const payload = {
  project: 'ripple',
  environment: 'production',
  runId: 21,
  commit: 'a'.repeat(40),
  actor: 'browser-supplied',
};

function request(origin = 'https://console.arsvine.com') {
  return new NextRequest('https://console.arsvine.com/api/web/deployments', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ role: 'owner', userId: 'owner-id' });
  mocks.csrf.mockReturnValue(true);
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.deploy.mockResolvedValue({ id: 'deployment-id', status: 'queued' });
});

describe('POST /api/web/deployments', () => {
  it('rejects editors and other origins before reaching the controller', async () => {
    mocks.session.mockResolvedValueOnce({ role: 'editor', userId: 'editor-id' });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request('https://other.example'))).status).toBe(403);
    expect(mocks.deploy).not.toHaveBeenCalled();
  });

  it('uses the verified session identity as the deployment actor', async () => {
    const result = await POST(request());
    expect(result.status).toBe(202);
    expect(mocks.deploy).toHaveBeenCalledWith({ ...payload, actor: 'owner-id' });
  });
});
