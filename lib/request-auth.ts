import type { NextRequest } from 'next/server';
import { getSessionFromRequest, type AuthenticatedSession } from './auth';
import { getWorkspaceConfig } from './accounts';
import { withWorkspace } from './workspace-context';
import { getDevelopmentWorkspaceConfig, isDevelopmentBypassSession } from './development-preview';

export async function requireSession(request: NextRequest) {
  return getSessionFromRequest(request);
}

export async function withSessionWorkspace<T>(session: AuthenticatedSession, callback: () => Promise<T>) {
  if (isDevelopmentBypassSession(session)) {
    return withWorkspace(getDevelopmentWorkspaceConfig(), callback, 'development');
  }
  const config = await getWorkspaceConfig(session.userId);
  return withWorkspace(config, callback);
}
