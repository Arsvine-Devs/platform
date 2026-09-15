import { NextResponse, type NextRequest } from 'next/server';
import { getApiBaseUrl } from './api-base';
import { getSessionFromRequest, verifyCsrf, type AuthenticatedSession } from './auth';

type ControlApiSuccess = {
  session: AuthenticatedSession;
  data: unknown;
  status: number;
};

type ControlApiFailure = { response: NextResponse; session?: AuthenticatedSession };

export type ControlApiResult = ControlApiSuccess | ControlApiFailure;

function failure(status: number, message: string, code?: string) {
  return NextResponse.json(
    { ok: false, error: { ...(code ? { code } : {}), message } },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function callControlApi(
  request: NextRequest,
  path: string,
  options: { method?: string; body?: unknown; requireCsrf?: boolean; headers?: HeadersInit } = {},
): Promise<ControlApiResult> {
  const session = await getSessionFromRequest(request);
  if (!session) return { response: failure(401, 'Unauthorized') };

  if (options.requireCsrf && !verifyCsrf(request, session)) {
    return { response: failure(403, 'Invalid CSRF token.', 'CSRF_INVALID'), session };
  }

  if (
    session.authSource !== 'oidc' ||
    !('accessToken' in session) ||
    typeof session.accessToken !== 'string'
  ) {
    return {
      response: failure(503, 'Control API session is unavailable.', 'CONTROL_API_UNAVAILABLE'),
      session,
    };
  }

  let url: URL;
  try {
    url = new URL(path.replace(/^\//, ''), getApiBaseUrl());
  } catch {
    return {
      response: failure(503, 'Control API is not configured.', 'CONTROL_API_UNAVAILABLE'),
      session,
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...options.headers,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(request.headers.get('if-match')
          ? { 'If-Match': request.headers.get('if-match')! }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error('[control-api] request failed:', error);
    return {
      response: failure(503, 'Control API unavailable.', 'CONTROL_API_UNAVAILABLE'),
      session,
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && payload !== null && 'error' in payload
        ? (payload as { error?: { code?: string; message?: string } }).error
        : undefined;
    return {
      response: failure(
        response.status,
        error?.message ?? `Control API request failed (${response.status}).`,
        error?.code,
      ),
      session,
    };
  }

  return { session, data: payload, status: response.status };
}

export function controlSuccess(result: ControlApiSuccess, data: unknown, status = result.status) {
  return NextResponse.json(
    { ok: true, data },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(result.status === 200 ? {} : {}),
      },
    },
  );
}

export function isControlApiSuccess(result: ControlApiResult): result is ControlApiSuccess {
  return 'data' in result;
}
