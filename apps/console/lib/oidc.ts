import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const OIDC_STATE_COOKIE = '__Host-console_oidc_state';
export const OIDC_SESSION_COOKIE = '__Host-console_session';
export const OIDC_SESSION_TTL_SECONDS = 60 * 60 * 12;

export type OidcState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

export type OidcTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  userId: string;
  email: string;
  role: 'owner' | 'editor';
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function requiredUrl(name: string) {
  const value = required(name);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return value;
}

function base64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function sessionSecret() {
  return required('SESSION_SECRET');
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function sealState(state: OidcState) {
  const payload = base64Url(Buffer.from(JSON.stringify(state), 'utf8'));
  return `${payload}.${sign(payload)}`;
}

export function openState(value: string | undefined): OidcState | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OidcState;
    if (!state.state || !state.nonce || !state.codeVerifier || state.expiresAt <= Date.now())
      return null;
    return state;
  } catch {
    return null;
  }
}

export function normalizeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/library';
  return value;
}

export function buildAuthorizationRequest(returnTo: string) {
  const state: OidcState = {
    state: base64Url(randomBytes(24)),
    nonce: base64Url(randomBytes(24)),
    codeVerifier: base64Url(randomBytes(32)),
    returnTo: normalizeReturnTo(returnTo),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const challenge = base64Url(createHash('sha256').update(state.codeVerifier).digest());
  const url = new URL(requiredUrl('AUTH_OIDC_AUTHORIZATION_URL'));
  url.search = new URLSearchParams({
    client_id: required('AUTH_OIDC_CLIENT_ID'),
    redirect_uri: requiredUrl('AUTH_OIDC_REDIRECT_URI'),
    response_type: 'code',
    scope:
      process.env.AUTH_OIDC_SCOPE?.trim() ||
      'openid profile email content:read content:write content:publish assets:read assets:write integrations:read integrations:write jobs:read jobs:run',
    resource: requiredUrl('AUTH_OIDC_RESOURCE'),
    state: state.state,
    nonce: state.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { state, authorizationUrl: url.toString() };
}

export function buildLogoutUrl(idTokenHint: string) {
  const url = new URL(requiredUrl('AUTH_OIDC_END_SESSION_URL'));
  url.search = new URLSearchParams({
    id_token_hint: idTokenHint,
    client_id: required('AUTH_OIDC_CLIENT_ID'),
    post_logout_redirect_uri: requiredUrl('AUTH_OIDC_POST_LOGOUT_REDIRECT_URI'),
  }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(code: string, state: OidcState) {
  const credentials = `${required('AUTH_OIDC_CLIENT_ID')}:${required('AUTH_OIDC_CLIENT_SECRET')}`;
  const response = await fetch(requiredUrl('AUTH_OIDC_TOKEN_URL'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: requiredUrl('AUTH_OIDC_REDIRECT_URI'),
      code_verifier: state.codeVerifier,
    }),
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !body?.access_token || !body.id_token) {
    throw new Error(body?.error_description ?? body?.error ?? 'OIDC token exchange failed.');
  }

  const jwks = createRemoteJWKSet(new URL(requiredUrl('AUTH_OIDC_JWKS_URL')));
  const verified = await jwtVerify(body.id_token, jwks, {
    issuer: requiredUrl('AUTH_OIDC_ISSUER'),
    audience: required('AUTH_OIDC_CLIENT_ID'),
  });
  if (verified.payload.nonce !== state.nonce) throw new Error('OIDC nonce validation failed.');

  const userInfoResponse = await fetch(requiredUrl('AUTH_OIDC_USERINFO_URL'), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${body.access_token}` },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  const userInfo = (await userInfoResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!userInfoResponse.ok || !userInfo) throw new Error('OIDC userinfo request failed.');

  const claims = { ...verified.payload, ...userInfo };
  const userId = typeof claims.sub === 'string' ? claims.sub : '';
  const email = typeof claims.email === 'string' ? claims.email : '';
  const roleValue = claims.role;
  const role = Array.isArray(roleValue)
    ? roleValue.find(
        (value): value is 'owner' | 'editor' => value === 'owner' || value === 'editor',
      )
    : roleValue === 'owner' || roleValue === 'editor'
      ? roleValue
      : undefined;
  if (!userId || !email || !role) throw new Error('OIDC identity claims are incomplete.');

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    idToken: body.id_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    userId,
    email,
    role,
  } satisfies OidcTokens;
}
