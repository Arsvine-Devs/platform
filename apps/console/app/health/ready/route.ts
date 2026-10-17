import { readEnv } from '@arsvine/env';
import { healthHeaders, readyBody } from '@arsvine/service-health';

function notReady(reason: string, status = 503) {
  return Response.json(
    { status: 'not_ready', service: 'console', reason },
    { status, headers: healthHeaders },
  );
}

const REQUIRED_CONFIGURATION = [
  'SESSION_SECRET',
  'AUTH_OIDC_CLIENT_ID',
  'AUTH_OIDC_CLIENT_SECRET',
] as const;

export async function GET() {
  const missing = REQUIRED_CONFIGURATION.filter((key) => !readEnv(key));
  if (missing.length > 0) return notReady(`missing_configuration:${missing.join(',')}`);
  return Response.json(readyBody('console'), { headers: healthHeaders });
}
