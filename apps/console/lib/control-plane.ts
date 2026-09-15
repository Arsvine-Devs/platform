import { getApiBaseUrl } from './api-base';

export type ControlPlanePrincipal = {
  id: string;
  role: 'owner' | 'editor' | null;
  scopes: string[];
};

export async function readControlPlanePrincipal(
  accessToken: string,
): Promise<ControlPlanePrincipal> {
  const url = new URL('/v1/me', getApiBaseUrl());
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => null)) as {
    id?: string;
    role?: 'owner' | 'editor' | null;
    scopes?: string[];
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.id || !Array.isArray(body.scopes)) {
    throw new Error(body?.error?.message ?? 'Control API authentication failed.');
  }
  return { id: body.id, role: body.role ?? null, scopes: body.scopes };
}
