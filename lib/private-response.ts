import { NextResponse } from 'next/server';

export function privateJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  const vary = headers.get('Vary');
  headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
  return NextResponse.json(body, { ...init, headers });
}
