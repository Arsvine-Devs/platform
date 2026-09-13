import { NextResponse, type NextRequest } from 'next/server';

import { getSessionFromRequest, isOwner } from '@/lib/auth';
import { getClientKey } from '@/lib/client-key';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import { parseCredentialTransports } from '@/lib/webauthn';
import { getOwnerAccount, listActiveWebAuthnCredentials } from '@/lib/webauthn-store';
import type { SecurityData } from '@/lib/admin-api/contracts';
import { getDevelopmentSecurity, isDevelopmentBypassEnabled, isDevelopmentBypassSession } from '@/lib/development-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isDevelopmentBypassEnabled()) {
    const developmentSession = await getSessionFromRequest(request);
    if (isDevelopmentBypassSession(developmentSession)) return privateJson({ ok: true, data: getDevelopmentSecurity() });
  }
  const limiter = await enforceRateLimit(`webauthn-credentials:${getClientKey(request)}`, 60, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '请求过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
  try {
    const owner = await getOwnerAccount();
    if (!owner || owner.id !== session.userId) return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });

    const credentials = await listActiveWebAuthnCredentials(owner.id);
    const data: SecurityData = {
      authMethod: owner.authMethod,
      credentials: credentials.map((credential) => ({
        id: credential.id,
        label: credential.label,
        aaguid: credential.aaguid,
        attestationFormat: credential.attestationFormat,
        transports: parseCredentialTransports(credential.transports),
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt ? credential.lastUsedAt.toISOString() : null,
      })),
    };
    return privateJson({
      ok: true,
      data,
    });
  } catch (error) {
    console.error('[admin/security/credentials] failed:', error instanceof Error ? error.message : error);
    return privateJson({ ok: false, error: { message: '无法读取安全设置。' } }, { status: 500 });
  }
}
