import { NextResponse, type NextRequest } from 'next/server';
import { siteConfig } from '@arsvine/site-config';
import { getSessionFromRequest, verifyCsrf } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requestDeployment, WebOpsError } from '@/lib/web-ops';

export const runtime = 'nodejs';

function result(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return result({ error: 'Sign in to deploy.' }, 401);
  if (
    session.role !== 'owner' ||
    request.headers.get('origin') !== siteConfig.console.origin ||
    !verifyCsrf(request, session)
  ) {
    return result({ error: 'This session cannot deploy.' }, 403);
  }

  const rate = await enforceRateLimit(`deployment:${session.userId}`, 10, 60_000);
  if (!rate.ok) return result({ error: 'Please wait before requesting another deployment.' }, 429);

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { project, environment, runId, commit } = payload ?? {};
  if (
    typeof project !== 'string' ||
    !/^[a-z][a-z0-9-]{0,23}$/.test(project) ||
    (environment !== 'production' && environment !== 'preview') ||
    typeof runId !== 'number' ||
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    typeof commit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(commit)
  ) {
    return result({ error: 'Select a valid build and environment.' }, 400);
  }

  try {
    const deployment = await requestDeployment({
      project,
      environment,
      runId,
      commit,
      actor: session.userId,
    });
    return result({ deployment }, 202);
  } catch (error) {
    const status =
      error instanceof WebOpsError && [400, 404, 409, 422].includes(error.status)
        ? error.status
        : 503;
    return result(
      {
        error:
          status === 503
            ? 'The deployment service is unavailable.'
            : 'This build could not be deployed.',
      },
      status,
    );
  }
}
