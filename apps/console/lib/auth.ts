import { timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import {
  clearOidcSessionCookie,
  getOidcSessionFromCookieStore,
  getOidcSessionFromRequest,
} from './oidc-session';

const CSRF_COOKIE = 'arsvine_admin_csrf';

export type AuthenticatedSession = {
  userId: string;
  email: string;
  role: 'owner' | 'editor';
  csrf: string;
  exp: number;
  sessionVersion: number;
  amr: 'oidc';
  authAt: number;
  authSource: 'oidc';
  accessToken: string;
  refreshToken?: string;
  idToken: string;
};

export async function getSessionFromRequest(request: NextRequest) {
  return (await getOidcSessionFromRequest(request)) as AuthenticatedSession | null;
}

export async function getSessionFromCookieStore() {
  return (await getOidcSessionFromCookieStore()) as AuthenticatedSession | null;
}

function constantTimeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyCsrf(request: NextRequest, session: AuthenticatedSession) {
  const header = request.headers.get('x-csrf-token')?.trim();
  const cookie = request.cookies.get(CSRF_COOKIE)?.value?.trim();
  return Boolean(
    header && cookie && constantTimeEqual(header, cookie) && constantTimeEqual(header, session.csrf),
  );
}

export function clearAuthCookies(response: NextResponse) {
  clearOidcSessionCookie(response);
  response.cookies.set(CSRF_COOKIE, '', {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function isOwner(session: AuthenticatedSession) {
  return session.role === 'owner';
}
