import { createHash } from 'node:crypto';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential } from '@simplewebauthn/server';
import type { NextRequest, NextResponse } from 'next/server';

import type { AuthenticatedSession } from './auth';

export const WEBAUTHN_CEREMONY_COOKIE = 'arsvine_webauthn_ceremony';
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WEBAUTHN_AUTH_RECENCY_MS = 10 * 60 * 1000;

export type WebAuthnConfig = {
  rpId: string;
  rpName: string;
  origin: string;
};

export type StoredWebAuthnCredential = {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBase64Url(value: unknown) {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isRecord(value) || !isBase64Url(value.id) || value.rawId !== value.id || value.type !== 'public-key' || !isRecord(value.response) || !isRecord(value.clientExtensionResults)) return false;
  return isBase64Url(value.response.clientDataJSON) && isBase64Url(value.response.authenticatorData) && isBase64Url(value.response.signature);
}

export function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isRecord(value) || !isBase64Url(value.id) || value.rawId !== value.id || value.type !== 'public-key' || !isRecord(value.response) || !isRecord(value.clientExtensionResults)) return false;
  return isBase64Url(value.response.clientDataJSON) && isBase64Url(value.response.attestationObject);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const rpId = process.env.WEBAUTHN_RP_ID?.trim().toLowerCase();
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim() || 'ARSVINE Admin';
  const rawOrigin = process.env.WEBAUTHN_ORIGIN?.trim();

  if (!rpId) throw new Error('Missing WEBAUTHN_RP_ID');
  if (!rawOrigin) throw new Error('Missing WEBAUTHN_ORIGIN');
  if (rpId !== 'localhost' && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(rpId)) {
    throw new Error('WEBAUTHN_RP_ID must be a valid domain name');
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch {
    throw new Error('WEBAUTHN_ORIGIN must be a valid absolute URL');
  }

  if (parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error('WEBAUTHN_ORIGIN must not include a path, query, or fragment');
  }

  if (isProduction() && parsedOrigin.protocol !== 'https:') {
    throw new Error('WEBAUTHN_ORIGIN must use HTTPS in production');
  }

  const originHost = parsedOrigin.hostname.toLowerCase();
  if (originHost !== rpId && !originHost.endsWith(`.${rpId}`)) {
    throw new Error('WEBAUTHN_RP_ID must be the origin host or a registrable suffix of it');
  }

  return { rpId, rpName, origin: parsedOrigin.origin };
}

export function webAuthnUserId(accountId: string) {
  const hex = accountId.replaceAll('-', '');
  if (/^[0-9a-f]{32}$/i.test(hex)) return new Uint8Array(Buffer.from(hex, 'hex'));
  return new TextEncoder().encode(accountId);
}

export function normalizeCredentialLabel(value: unknown) {
  if (typeof value !== 'string') throw new Error('请输入安全密钥名称。');
  const label = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!label || label.length > 64) throw new Error('安全密钥名称长度无效。');
  return label;
}

export function parseCredentialTransports(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

export function serializeCredentialTransports(value: unknown) {
  if (!Array.isArray(value)) return '[]';
  return JSON.stringify(value.filter((item): item is string => typeof item === 'string').slice(0, 8));
}

export function isRecentWebAuthnSession(session: AuthenticatedSession, now = Date.now()) {
  return session.amr === 'webauthn' && now - session.authAt >= 0 && now - session.authAt <= WEBAUTHN_AUTH_RECENCY_MS;
}

export function isHardwareOrientedCredential(deviceType: string, backedUp: boolean) {
  return deviceType === 'singleDevice' && !backedUp;
}

export function hashSessionBinding(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

export function applyWebAuthnCeremonyCookie(response: NextResponse, ceremonyId: string) {
  response.cookies.set(WEBAUTHN_CEREMONY_COOKIE, ceremonyId, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: WEBAUTHN_CHALLENGE_TTL_MS / 1000,
  });
}

export function clearWebAuthnCeremonyCookie(response: NextResponse) {
  response.cookies.set(WEBAUTHN_CEREMONY_COOKIE, '', {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

export function getWebAuthnCeremonyId(request: NextRequest) {
  return request.cookies.get(WEBAUTHN_CEREMONY_COOKIE)?.value?.trim() || null;
}

export async function createAuthenticationOptions(credentials: StoredWebAuthnCredential[]) {
  const config = getWebAuthnConfig();
  return generateAuthenticationOptions({
    rpID: config.rpId,
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
  });
}

export async function createRegistrationOptions(account: { id: string; email: string }, credentials: StoredWebAuthnCredential[]) {
  const config = getWebAuthnConfig();
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: webAuthnUserId(account.id),
    userName: account.email,
    userDisplayName: 'ARSVINE Owner',
    timeout: 60_000,
    attestationType: 'direct',
    preferredAuthenticatorType: 'securityKey',
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
  });
}

export async function verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string) {
  const config = getWebAuthnConfig();
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    requireUserPresence: true,
    requireUserVerification: true,
  });
}

export async function verifyAuthentication(response: AuthenticationResponseJSON, credential: WebAuthnCredential, expectedChallenge: string) {
  const config = getWebAuthnConfig();
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    credential,
    requireUserVerification: true,
  });
}
