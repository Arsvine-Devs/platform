import { NextResponse, type NextRequest } from 'next/server';
import { getWorkspaceConfig, getWorkspaceSummary, saveWorkspaceConfig } from '../../../../lib/accounts';
import { getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { resolveXTimelineSyncMethod, type WorkspaceConfig } from '../../../../lib/workspace-context';
import { privateJson } from '../../../../lib/private-response';
import type { WorkspaceSummary, WorkspaceUpdateInput } from '../../../../lib/admin-api/contracts';
import { getDevelopmentWorkspaceSummary, isDevelopmentBypassSession, updateDevelopmentWorkspace } from '../../../../lib/development-preview';

function unauthorized() { return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 }); }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (isDevelopmentBypassSession(session)) return privateJson({ ok: true, data: getDevelopmentWorkspaceSummary() });
  try {
    const data: WorkspaceSummary = await getWorkspaceSummary(session.userId);
    return privateJson({ ok: true, data });
  }
  catch (error) { return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法读取工作区配置。' } }, { status: 404 }); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!verifyCsrf(request, session)) return NextResponse.json({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });
  if (isDevelopmentBypassSession(session)) {
    const input = (await request.json()) as WorkspaceUpdateInput;
    return privateJson({ ok: true, data: updateDevelopmentWorkspace(input) });
  }
  try {
    const input = (await request.json()) as WorkspaceUpdateInput;
    let existing: WorkspaceConfig | null = null;
    try { existing = await getWorkspaceConfig(session.userId); } catch { /* first configuration */ }
    let x: WorkspaceConfig['x'] = existing?.x;
    if (input.x === null) {
      x = undefined;
    } else if (input.x) {
      const targetUserId = input.x.targetUserId?.trim() || existing?.x?.targetUserId || '';
      const targetUsername = input.x.targetUsername?.trim() || existing?.x?.targetUsername || '';
      const bearerToken = input.x.bearerToken?.trim() || existing?.x?.bearerToken || '';
      const syncMethod = input.x.syncMethod ?? (
        existing?.x ? resolveXTimelineSyncMethod(existing.x) : 'none'
      );
      const hasAnyXValue = Boolean(targetUserId || targetUsername || bearerToken || input.x.syncMethod);
      if (hasAnyXValue && !(syncMethod === 'none' && !targetUserId && !targetUsername && !bearerToken)) {
        if (!/^\d{1,19}$/.test(targetUserId)) throw new Error('X target user id must be a numeric user id.');
        if (!/^[A-Za-z0-9_]{1,15}$/.test(targetUsername)) throw new Error('X username is invalid.');
        if (syncMethod === 'api' && !bearerToken) throw new Error('Please configure an X bearer token.');
        x = {
          syncMethod,
          bearerToken,
          targetUserId,
          targetUsername,
          includeReplies: input.x.includeReplies ?? existing?.x?.includeReplies ?? true,
          includeRetweets: input.x.includeRetweets ?? existing?.x?.includeRetweets ?? false,
          sync: existing?.x?.sync,
        };
      }
    }
    const config: WorkspaceConfig = {
      github: {
        owner: input.github?.owner?.trim() || existing?.github.owner || '',
        repo: input.github?.repo?.trim() || existing?.github.repo || '',
        branch: input.github?.branch?.trim() || existing?.github.branch || 'main',
        token: input.github?.token?.trim() || existing?.github.token || '',
      },
      revalidate: {
        contentUrl: input.revalidate?.contentUrl?.trim() || existing?.revalidate.contentUrl,
        tweetsUrl: input.revalidate?.tweetsUrl?.trim() || existing?.revalidate.tweetsUrl,
        secret: input.revalidate?.secret?.trim() || existing?.revalidate.secret,
      },
      translation: input.translation?.baseUrl?.trim() || existing?.translation
        ? { baseUrl: input.translation?.baseUrl?.trim() || existing?.translation?.baseUrl || '', apiKey: input.translation?.apiKey?.trim() || existing?.translation?.apiKey || '', model: input.translation?.model?.trim() || existing?.translation?.model, thinking: input.translation?.thinking?.trim() || existing?.translation?.thinking, reasoningEffort: input.translation?.reasoningEffort?.trim() || existing?.translation?.reasoningEffort }
        : undefined,
      x,
    };
    if (!config.github.owner || !config.github.repo || !config.github.token) throw new Error('请填写完整的私有仓库配置。');
    if (config.translation && (!config.translation.baseUrl || !config.translation.apiKey)) throw new Error('翻译服务地址和密钥必须同时填写。');
    await saveWorkspaceConfig(session.userId, config);
    const data: WorkspaceSummary = await getWorkspaceSummary(session.userId);
    return privateJson({ ok: true, data });
  } catch (error) { return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法保存工作区配置。' } }, { status: 422 }); }
}
