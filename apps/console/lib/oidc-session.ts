import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import {
  OIDC_SESSION_COOKIE,
  OIDC_SESSION_TTL_SECONDS,
  type OidcTokens,
} from './oidc';
import type { AuthenticatedSession } from './auth';

type StoredOidcSession = OidcTokens & AuthenticatedSession & { authSource: 'oidc' };

const localSessions = new Map<string, { value: string; expiresAt: number }>();
let redis: Redis | null = null;

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  redis ??= new Redis({ url, token });
  return redis;
}

function key() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error('Missing SESSION_SECRET');
  return createHash('sha256').update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Invalid OIDC session envelope');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function write(id: string, value: string) {
  const store = getRedis();
  if (store) {
    await store.set(`console:oidc:${id}`, value, { ex: OIDC_SESSION_TTL_SECONDS });
    return;
  }
  localSessions.set(id, { value, expiresAt: Date.now() + OIDC_SESSION_TTL_SECONDS * 1000 });
}

async function read(id: string) {
  const store = getRedis();
  if (store) return (await store.get<string>(`console:oidc:${id}`)) ?? null;
  const entry = localSessions.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    localSessions.delete(id);
    return null;
  }
  return entry.value;
}

async function remove(id: string) {
  const store = getRedis();
  if (store) await store.del(`console:oidc:${id}`);
  localSessions.delete(id);
}

export async function createOidcSession(tokens: OidcTokens) {
  const id = randomBytes(32).toString('base64url');
  const session: StoredOidcSession = {
    ...tokens,
    userId: tokens.userId,
    email: tokens.email,
    role: tokens.role,
    csrf: randomBytes(18).toString('base64url'),
    exp: Date.now() + OIDC_SESSION_TTL_SECONDS * 1000,
    sessionVersion: 1,
    authAt: Date.now(),
    amr: 'oidc',
    authSource: 'oidc',
  };
  await write(id, encrypt(JSON.stringify(session)));
  return { id, session };
}

export async function getOidcSession(id: string | undefined): Promise<StoredOidcSession | null> {
  if (!id) return null;
  const value = await read(id);
  if (!value) return null;
  try {
    const session = JSON.parse(decrypt(value)) as StoredOidcSession;
    if (session.exp <= Date.now() || session.authSource !== 'oidc') {
      await remove(id);
      return null;
    }
    return session;
  } catch {
    await remove(id);
    return null;
  }
}

export async function deleteOidcSession(id: string | undefined) {
  if (id) await remove(id);
}

export function oidcSessionIdFromRequest(request: NextRequest) {
  return request.cookies.get(OIDC_SESSION_COOKIE)?.value;
}

export async function getOidcSessionFromRequest(request: NextRequest) {
  return getOidcSession(oidcSessionIdFromRequest(request));
}

export async function getOidcSessionFromCookieStore() {
  const store = await cookies();
  return getOidcSession(store.get(OIDC_SESSION_COOKIE)?.value);
}

export function applyOidcSessionCookies(
  response: NextResponse,
  id: string,
  csrf: string,
) {
  response.cookies.set(OIDC_SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_SESSION_TTL_SECONDS,
  });
  response.cookies.set('arsvine_admin_csrf', csrf, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_SESSION_TTL_SECONDS,
  });
}

export function clearOidcSessionCookie(response: NextResponse) {
  response.cookies.set(OIDC_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
