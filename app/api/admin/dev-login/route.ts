import { NextResponse } from 'next/server';

import {
  applyDevelopmentAuthCookies,
  clearAuthCookies,
  createDevelopmentSession,
} from '@/lib/auth';
import { DEVELOPMENT_EMAIL, isDevelopmentBypassEnabled } from '@/lib/development-preview';

export async function POST() {
  if (!isDevelopmentBypassEnabled()) {
    return NextResponse.json(
      { ok: false, error: { message: 'Development preview is disabled.' } },
      { status: 404 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    data: { email: DEVELOPMENT_EMAIL, role: 'owner' as const, developmentBypass: true },
  });
  clearAuthCookies(response);
  applyDevelopmentAuthCookies(response, createDevelopmentSession());
  return response;
}
