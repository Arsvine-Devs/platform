import { getWorkspaceConfig, listActiveWorkspaceConfigs, saveWorkspaceConfig } from './accounts';
import { triggerTweetsRevalidate } from './github';
import {
  getRecentImportedXExternalIds,
  mergeImportedTweets,
  removeImportedTweetsByExternalIds,
} from './tweets';
import { fetchXPostsByIds, fetchXTimelinePage, XApiError } from './x-timeline';
import type { ImportedTweet } from './tweets-types';
import {
  resolveXTimelineSyncMethod,
  type WorkspaceConfig,
  type XTimelineConfig,
} from './workspace-context';
import { withWorkspace } from './workspace-context';

export type XTimelineSyncMode = 'recent' | 'backfill';

export type XTimelineSyncOptions = {
  mode?: XTimelineSyncMode;
  maxPages?: number;
};

export type XTimelineSyncResult = {
  configured: true;
  mode: XTimelineSyncMode;
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  changed: boolean;
  months: string[];
  hasMore: boolean;
  nextCursor?: string;
  revalidated?: { revalidated: boolean; paths: string[]; error?: string };
  syncedAt: string;
};

export class XTimelineSyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'XTimelineSyncError';
  }
}

function maxPostId(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return left >= right ? left : right;
}

function normalizeOptions(
  options: XTimelineSyncOptions,
): Required<Pick<XTimelineSyncOptions, 'mode' | 'maxPages'>> {
  return {
    mode: options.mode ?? 'recent',
    maxPages: Math.min(5, Math.max(1, Math.floor(options.maxPages ?? 5))),
  };
}

function requireXConfig(config: WorkspaceConfig): XTimelineConfig {
  if (!config.x)
    throw new XTimelineSyncError(422, 'X timeline is not configured for this workspace.');
  if (resolveXTimelineSyncMethod(config.x) !== 'api')
    throw new XTimelineSyncError(422, 'X timeline sync is not enabled for the selected method.');
  if (!config.x.bearerToken) throw new XTimelineSyncError(422, 'X bearer token is not configured.');
  return config.x;
}

export async function syncXTimelineForUser(userId: string, options: XTimelineSyncOptions = {}) {
  const config = await getWorkspaceConfig(userId);
  return syncXTimelineForWorkspace(userId, config, options);
}

async function syncXTimelineForWorkspace(
  userId: string,
  config: WorkspaceConfig,
  options: XTimelineSyncOptions = {},
): Promise<XTimelineSyncResult> {
  const { mode, maxPages } = normalizeOptions(options);
  const xConfig = requireXConfig(config);
  const previousState = xConfig.sync ?? {};
  const syncedAt = new Date().toISOString();
  const posts: ImportedTweet[] = [];
  let cursor = previousState.paginationToken;
  const requestSinceId = cursor
    ? previousState.paginationSinceId
    : mode === 'backfill'
      ? undefined
      : previousState.sinceId;
  let newestId = previousState.sinceId;

  try {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await fetchXTimelinePage(xConfig, {
        sinceId: requestSinceId,
        paginationToken: cursor,
        paginationSinceId: requestSinceId,
      });
      posts.push(...page.posts);
      newestId = maxPostId(newestId, page.newestId);
      for (const post of page.posts) newestId = maxPostId(newestId, post.externalId);

      if (!page.nextCursor) {
        cursor = undefined;
        break;
      }
      cursor = page.nextCursor;
    }

    let removed = 0;
    const reconcileCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    try {
      const recentExternalIds = await withWorkspace(config, () =>
        getRecentImportedXExternalIds(reconcileCutoff),
      );
      if (recentExternalIds.length > 0) {
        const reconciled = await fetchXPostsByIds(xConfig, recentExternalIds);
        posts.push(...reconciled.posts);
        const newPostIds = new Set(posts.map((post) => post.externalId));
        const missingIds = reconciled.missingIds.filter((id) => !newPostIds.has(id));
        if (missingIds.length > 0) {
          removed = (
            await withWorkspace(config, () =>
              removeImportedTweetsByExternalIds(missingIds, syncedAt),
            )
          ).removed;
        }
      }
    } catch (error) {
      // Reconciliation is best-effort. A successful incremental page must still
      // be committed when the optional lookup is rate-limited or unavailable.
      console.warn(
        '[x-timeline] recent reconcile skipped:',
        error instanceof Error ? error.message : error,
      );
    }

    const merge = await withWorkspace(config, () => mergeImportedTweets(posts, syncedAt));
    const nextConfig: WorkspaceConfig = {
      ...config,
      x: {
        ...xConfig,
        sync: {
          ...previousState,
          ...(newestId ? { sinceId: newestId } : {}),
          ...(cursor
            ? {
                paginationToken: cursor,
                ...(requestSinceId ? { paginationSinceId: requestSinceId } : {}),
              }
            : { paginationToken: undefined, paginationSinceId: undefined }),
          lastSyncAt: syncedAt,
          lastSyncError: undefined,
        },
      },
    };
    await saveWorkspaceConfig(userId, nextConfig);

    const changed = merge.changed || removed > 0;
    const revalidated = changed
      ? await withWorkspace(nextConfig, triggerTweetsRevalidate)
      : undefined;
    return {
      configured: true,
      mode,
      fetched: posts.length,
      created: merge.created,
      updated: merge.updated,
      removed,
      changed,
      months: merge.months,
      hasMore: Boolean(cursor),
      nextCursor: cursor,
      revalidated,
      syncedAt,
    };
  } catch (error) {
    const safeError =
      error instanceof XApiError || error instanceof XTimelineSyncError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'X timeline sync failed.';
    try {
      await saveWorkspaceConfig(userId, {
        ...config,
        x: { ...xConfig, sync: { ...previousState, lastSyncError: safeError } },
      });
    } catch (stateError) {
      console.error('[x-timeline] failed to persist sync error:', stateError);
    }
    if (error instanceof XTimelineSyncError) throw error;
    if (error instanceof XApiError)
      throw new XTimelineSyncError(
        error.status >= 400 && error.status < 500 ? 502 : 502,
        safeError,
      );
    throw new XTimelineSyncError(502, safeError);
  }
}

export async function syncAllConfiguredXWorkspaces(options: XTimelineSyncOptions = {}) {
  const workspaces = await listActiveWorkspaceConfigs();
  const results: Array<{ userId: string; result?: XTimelineSyncResult; error?: string }> = [];

  for (const workspace of workspaces) {
    if (!workspace.config.x || resolveXTimelineSyncMethod(workspace.config.x) !== 'api') continue;
    try {
      results.push({
        userId: workspace.userId,
        result: await syncXTimelineForWorkspace(workspace.userId, workspace.config, options),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'X timeline sync failed.';
      console.error(`[x-timeline] workspace ${workspace.userId} failed:`, message);
      results.push({ userId: workspace.userId, error: message });
    }
  }

  return results;
}
