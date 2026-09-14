import type { AdminApiResponse } from './contracts';

export type AdminRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  csrfToken?: string;
  headers?: HeadersInit;
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { status: number; code?: string; retryAfterMs?: number }) {
    super(message);
    this.name = 'AdminApiError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdminResponse(value: unknown): value is AdminApiResponse<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return true;
  return (
    isRecord(value.error) &&
    typeof value.error.message === 'string' &&
    (value.error.code === undefined || typeof value.error.code === 'string')
  );
}

function parseRetryAfter(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function readJson(response: Response): Promise<{ payload: unknown; empty: boolean }> {
  const text = await response.text();
  if (!text.trim()) return { payload: null, empty: true };
  try {
    return { payload: JSON.parse(text) as unknown, empty: false };
  } catch {
    return { payload: null, empty: false };
  }
}

export async function adminRequest<T>(
  input: string | URL,
  options: AdminRequestOptions = {},
): Promise<T> {
  const { body, csrfToken, headers: initHeaders, ...requestInit } = options;
  const headers = new Headers(initHeaders);
  headers.set('Accept', 'application/json');
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...requestInit,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new AdminApiError('网络请求失败，请检查连接后重试。', { status: 0 });
  }

  const { payload, empty } = await readJson(response);
  const retryAfterMs = parseRetryAfter(response);
  if (empty && response.ok) {
    return undefined as T;
  }
  if (!isAdminResponse(payload)) {
    throw new AdminApiError(
      response.ok ? '服务器返回了无法识别的响应。' : `请求失败（HTTP ${response.status}）。`,
      { status: response.status, retryAfterMs },
    );
  }

  if (!payload.ok) {
    throw new AdminApiError(payload.error.message, {
      status: response.status,
      code: payload.error.code,
      retryAfterMs,
    });
  }

  return ('data' in payload ? payload.data : undefined) as T;
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}
