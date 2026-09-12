import { AsyncLocalStorage } from 'node:async_hooks';

export type WorkspaceConfig = {
  github: { owner: string; repo: string; branch: string; token: string };
  revalidate: { contentUrl?: string; tweetsUrl?: string; secret?: string };
  translation?: { baseUrl: string; apiKey: string; model?: string; thinking?: string; reasoningEffort?: string };
  x?: XTimelineConfig;
};

export type XTimelineSyncState = {
  sinceId?: string;
  paginationToken?: string;
  paginationSinceId?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
};

export type XTimelineSyncMethod = 'none' | 'api';

export type XTimelineConfig = {
  syncMethod?: XTimelineSyncMethod;
  /** Kept for reading configurations written before syncMethod was introduced. */
  enabled?: boolean;
  bearerToken: string;
  targetUserId: string;
  targetUsername: string;
  includeReplies: boolean;
  includeRetweets: boolean;
  sync?: XTimelineSyncState;
};

export function resolveXTimelineSyncMethod(config: XTimelineConfig): XTimelineSyncMethod {
  if (config.syncMethod) return config.syncMethod;
  return config.enabled === false || !config.bearerToken ? 'none' : 'api';
}

const storage = new AsyncLocalStorage<WorkspaceConfig>();

export function withWorkspace<T>(config: WorkspaceConfig, callback: () => T) {
  return storage.run(config, callback);
}

export function getWorkspace() {
  const config = storage.getStore();
  if (!config) throw new Error('Missing authenticated workspace configuration');
  return config;
}
