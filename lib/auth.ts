import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { getActiveAccount } from './accounts';
import { isDevelopmentBypassEnabled } from './development-preview';

const SESSION_COOKIE = 'arsvine_admin_session';
const CSRF_COOKIE = 'arsvine_admin_csrf';
export const DEVELOPMENT_SESSION_COOKIE = 'arsvine_admin_dev_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type AuthMethod = 'password+totp' | 'webauthn';
export type AuthenticatedSession = {
  userId: string;
  email: string;
  role: 'owner' | 'editor';
  csrf: string;
  exp: number;
  sessionVersion: number;
  amr: AuthMethod;
  authAt: number;
  developmentBypass?: boolean;
};

type SignedSession = Omit<AuthenticatedSession, 'email'> & { sig: string };

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error('Missing SESSION_SECRET');
  return secret;
}

function signSession(session: Omit<SignedSession, 'sig'>) {
  return createHmac('sha256', getSessionSecret())
    .update(`${session.userId}:${session.role}:${session.sessionVersion}:${session.exp}:${session.csrf}:${session.amr}:${session.authAt}`)
    .digest('base64url');
}

type DevelopmentSession = Omit<AuthenticatedSession, 'developmentBypass'> & { developmentBypass: true; sig: string };

function signDevelopmentSession(session: Omit<DevelopmentSession, 'sig'>) {
  return createHmac('sha256', getSessionSecret())
    .update(`development:${session.userId}:${session.email}:${session.role}:${session.sessionVersion}:${session.exp}:${session.csrf}:${session.amr}:${session.authAt}:${session.developmentBypass}`)
    .digest('base64url');
}

function decodeDevelopment(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as DevelopmentSession;
  } catch {
    return null;
  }
}

function resolveDevelopment(value: string | undefined): AuthenticatedSession | null {
  if (!isDevelopmentBypassEnabled()) return null;
  const parsed = decodeDevelopment(value);
  if (!parsed || parsed.developmentBypass !== true || typeof parsed.email !== 'string' || typeof parsed.csrf !== 'string' || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now() || parsed.userId !== '00000000-0000-4000-8000-000000000099' || parsed.role !== 'owner' || !Number.isFinite(parsed.sessionVersion) || parsed.amr !== 'password+totp' || !Number.isFinite(parsed.authAt)) return null;
  const expected = Buffer.from(signDevelopmentSession(parsed));
  const actual = Buffer.from(parsed.sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { userId: parsed.userId, email: parsed.email, role: parsed.role, csrf: parsed.csrf, exp: parsed.exp, sessionVersion: parsed.sessionVersion, amr: parsed.amr, authAt: parsed.authAt, developmentBypass: true };
}

export function createDevelopmentSession() {
  const csrf = randomBytes(18).toString('base64url');
  const unsigned: Omit<DevelopmentSession, 'sig'> = {
    userId: '00000000-0000-4000-8000-000000000099',
    email: 'preview@localhost',
    role: 'owner',
    csrf,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
    sessionVersion: 1,
    amr: 'password+totp',
    authAt: Date.now(),
    developmentBypass: true,
  };
  return { value: Buffer.from(JSON.stringify({ ...unsigned, sig: signDevelopmentSession(unsigned) }), 'utf8').toString('base64url'), csrf, exp: unsigned.exp };
}

function decode(value: string) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SignedSession; } catch { return null; }
}

function validSignature(session: SignedSession | null): session is SignedSession {
  if (!session || session.exp <= Date.now() || !Number.isFinite(session.authAt) || (session.amr !== 'password+totp' && session.amr !== 'webauthn')) return false;
  const expected = Buffer.from(signSession(session));
  const actual = Buffer.from(session.sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type SessionAccount = { id: string; role: 'owner' | 'editor'; sessionVersion: number };

export function createSession(account: SessionAccount, amr: AuthMethod = 'password+totp', authAt = Date.now()) {
  const csrf = randomBytes(18).toString('base64url');
  const unsigned = { userId: account.id, role: account.role, sessionVersion: account.sessionVersion, exp: Date.now() + SESSION_TTL_SECONDS * 1000, csrf, amr, authAt };
  return { value: Buffer.from(JSON.stringify({ ...unsigned, sig: signSession(unsigned) }), 'utf8').toString('base64url'), csrf, exp: unsigned.exp };
}

async function resolve(value: string | undefined): Promise<AuthenticatedSession | null> {
  const parsed = value ? decode(value) : null;
  if (!validSignature(parsed)) return null;
  const account = await getActiveAccount(parsed.userId);
  if (!account || account.role !== parsed.role || account.sessionVersion !== parsed.sessionVersion) return null;
  if ((account.role === 'owner' && parsed.amr !== account.authMethod) || (account.role === 'editor' && parsed.amr !== 'password+totp')) return null;
  return { ...parsed, email: account.email };
}

export async function getSessionFromRequest(request: NextRequest) {
  const development = resolveDevelopment(request.cookies.get(DEVELOPMENT_SESSION_COOKIE)?.value);
  if (development) return development;
  return resolve(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function getSessionFromCookieStore() {
  const store = await cookies();
  const development = resolveDevelopment(store.get(DEVELOPMENT_SESSION_COOKIE)?.value);
  if (development) return development;
  return resolve(store.get(SESSION_COOKIE)?.value);
}

export function applyAuthCookies(response: NextResponse, session: ReturnType<typeof createSession>) {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
  response.cookies.set(CSRF_COOKIE, session.csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
}

export function clearAuthCookies(response: NextResponse) {
  const secure = process.env.NODE_ENV === 'production';
  for (const name of [SESSION_COOKIE, DEVELOPMENT_SESSION_COOKIE, CSRF_COOKIE]) response.cookies.set(name, '', { httpOnly: name !== CSRF_COOKIE, secure, sameSite: 'lax', path: '/', maxAge: 0 });
}

export function applyDevelopmentAuthCookies(response: NextResponse, session: ReturnType<typeof createDevelopmentSession>) {
  response.cookies.set(DEVELOPMENT_SESSION_COOKIE, session.value, { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
  response.cookies.set(CSRF_COOKIE, session.csrf, { httpOnly: false, secure: false, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
}

function constantTimeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyCsrf(request: NextRequest, session: AuthenticatedSession) {
  const header = request.headers.get('x-csrf-token')?.trim();
  const cookie = request.cookies.get(CSRF_COOKIE)?.value?.trim();
  return Boolean(header && cookie && constantTimeEqual(header, cookie) && constantTimeEqual(header, session.csrf));
}

export function isOwner(session: AuthenticatedSession) { return session.role === 'owner'; }
