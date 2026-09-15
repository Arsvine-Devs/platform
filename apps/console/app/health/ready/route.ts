function notReady(reason: string, status = 503) {
  return Response.json(
    { status: 'not_ready', service: 'console', reason },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET() {
  const missing = [
    'SESSION_SECRET',
    'AUTH_OIDC_ISSUER',
    'AUTH_OIDC_RESOURCE',
    'API_BASE_URL',
  ].filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) return notReady(`missing_configuration:${missing.join(',')}`);
  return Response.json(
    { status: 'ready', service: 'console' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
