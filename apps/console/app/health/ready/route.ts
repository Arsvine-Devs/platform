function notReady(reason: string, status = 503) {
  return Response.json(
    { status: 'not_ready', service: 'console', reason },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

const REQUIRED_CONFIGURATION = [
  'SESSION_SECRET',
  'AUTH_OIDC_ISSUER',
  'AUTH_OIDC_AUTHORIZATION_URL',
  'AUTH_OIDC_TOKEN_URL',
  'AUTH_OIDC_USERINFO_URL',
  'AUTH_OIDC_JWKS_URL',
  'AUTH_OIDC_CLIENT_ID',
  'AUTH_OIDC_CLIENT_SECRET',
  'AUTH_OIDC_REDIRECT_URI',
  'AUTH_OIDC_END_SESSION_URL',
  'AUTH_OIDC_POST_LOGOUT_REDIRECT_URI',
  'AUTH_OIDC_RESOURCE',
  'API_BASE_URL',
] as const;

export async function GET() {
  const missing = REQUIRED_CONFIGURATION.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) return notReady(`missing_configuration:${missing.join(',')}`);
  return Response.json(
    { status: 'ready', service: 'console' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
