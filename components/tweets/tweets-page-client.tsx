'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import ComposerPanel, { INITIAL_TWEET_FORM, type TweetFormState } from './composer-panel';
import MonthIndexPanel from './month-index-panel';
import TweetListPanel from './tweet-list-panel';
import { VISIBILITY_LABELS } from './filter-labels';
import {
  filterTweets,
  formatDateTimeLocal,
  formatDateGroupLabel,
  groupTweetsByGranularity,
  monthFromCreatedAt,
  parseTags,
  pickActiveDateGroup,
  tagsToInput,
  type DateGranularity,
} from './tweet-utils';
import { getTranslationTargetLocales } from '../../lib/tweets-types';
import type {
  CreateTweetInput,
  TweetFilter,
  TweetItem,
  TweetsDashboardData,
  UpdateTweetInput,
  TweetVisibility,
} from '../../lib/tweets-types';

type TweetsPageClientProps = {
  csrfToken: string;
};

type AdminResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

function unwrapError(json: AdminResponse<unknown>, fallback: string) {
  return json.ok ? fallback : json.error.message;
}

function normalizeFormFromTweetItem(tweet: TweetItem): TweetFormState {
  return {
    content: tweet.content,
    lang: tweet.lang ?? 'zh-CN',
    tags: tagsToInput(tweet.tags),
    visibility: (tweet.visibility ?? 'public') as TweetVisibility,
    pinned: Boolean(tweet.pinned),
    createdAt: formatDateTimeLocal(tweet.createdAt),
    autoTranslate: false,
  };
}

export default function TweetsPageClient({ csrfToken }: TweetsPageClientProps) {
  const [data, setData] = useState<TweetsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [granularity, setGranularity] = useState<DateGranularity>('month');
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [filter, setFilter] = useState<TweetFilter>('all');
  const [editingTweetId, setEditingTweetId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<TweetFormState>(INITIAL_TWEET_FORM);
  const [pendingDelete, setPendingDelete] = useState<TweetItem | null>(null);
  const [syncing, setSyncing] = useState<'recent' | 'backfill' | null>(null);

  const loadDashboard = useCallback(async (preferredGroupKey?: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/tweets', { cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const json = (await response.json()) as AdminResponse<TweetsDashboardData>;
      if (!response.ok || !json.ok) {
        throw new Error(unwrapError(json, 'Failed to load tweets.'));
      }
      setData(json.data);
      if (preferredGroupKey) {
        setSelectedGroupKey(preferredGroupKey);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载推文数据失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const months = useMemo(() => data?.months ?? [], [data]);
  const groups = useMemo(() => groupTweetsByGranularity(months, granularity), [months, granularity]);
  const activeGroupKey = pickActiveDateGroup(groups, selectedGroupKey || null);
  const activeGroup = groups.find((group) => group.key === activeGroupKey) ?? null;
  const currentGroupTweets = activeGroup?.tweets ?? [];
  const filteredTweets = filterTweets(currentGroupTweets, filter);
  const allTweets = months.flatMap((m) => m.tweets);
  const editingTweet = editingTweetId
    ? allTweets.find((t) => t.id === editingTweetId) ?? null
    : null;

  const composerMonth = monthFromCreatedAt(form.createdAt);
  const targetMonthPath = composerMode
    ? composerMonth
      ? `tweets/${composerMonth}.json`
      : 'tweets/YYYY-MM.json'
    : activeGroup
      ? activeGroup.months.length === 1
        ? `tweets/${activeGroup.months[0]}.json`
        : `tweets/${activeGroup.months.length} files`
      : 'tweets/YYYY-MM.json';

  const translationTargets = useMemo(
    () => getTranslationTargetLocales(form.lang as CreateTweetInput['lang']),
    [form.lang],
  );

  function updateField<K extends keyof TweetFormState>(key: K, value: TweetFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setEditingTweetId(null);
    setComposerMode(null);
    setForm(INITIAL_TWEET_FORM());
  }

  function startCreate() {
    setEditingTweetId(null);
    setComposerMode('create');
    setForm(INITIAL_TWEET_FORM());
  }

  function startEdit(tweet: TweetItem) {
    setEditingTweetId(tweet.id);
    setComposerMode('edit');
    setForm(normalizeFormFromTweetItem(tweet));
  }

  async function runMutation(
    url: string,
    init: RequestInit,
    successMessage: string,
    nextMonth?: string,
  ) {
    setSaving(true);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          ...(init.headers ?? {}),
        },
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return null;
      }
      const json = (await response.json()) as AdminResponse<unknown>;
      if (!response.ok || !json.ok) {
        throw new Error(unwrapError(json, '保存失败。'));
      }
      await loadDashboard(nextMonth);
      toast.success(successMessage);
      return json;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败。');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (composerMode === 'edit' && editingTweet) {
      const editMonth = monthFromCreatedAt(form.createdAt) || activeGroup?.months[0] || '';
      const payload: UpdateTweetInput = {
        content: form.content,
        lang: form.lang as UpdateTweetInput['lang'],
        tags: parseTags(form.tags),
        visibility: form.visibility,
        pinned: form.pinned,
      };
      const result = await runMutation(
        `/api/admin/tweets/${editingTweet.id}`,
        { method: 'PUT', body: JSON.stringify(payload) },
        '推文已更新。',
        editMonth,
      );
      if (result) {
        resetForm();
      }
      return;
    }
    const targetMonth = monthFromCreatedAt(form.createdAt);
    const payload: CreateTweetInput = {
      content: form.content,
      lang: form.lang as CreateTweetInput['lang'],
      tags: parseTags(form.tags),
      visibility: form.visibility,
      pinned: form.pinned,
      createdAt: form.createdAt,
      autoTranslate: form.autoTranslate,
    };
    const result = await runMutation(
      '/api/admin/tweets',
      { method: 'POST', body: JSON.stringify(payload) },
      form.autoTranslate ? '推文与自动译文已创建。' : '推文已创建。',
      targetMonth,
    );
    if (result) {
      resetForm();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const tweet = pendingDelete;
    setPendingDelete(null);
    const deleteMonth =
      editingTweetId === tweet.id
        ? monthFromCreatedAt(form.createdAt) || activeGroup?.months[0] || ''
        : activeGroup?.months[0] || '';
    const result = await runMutation(
      `/api/admin/tweets/${tweet.id}`,
      { method: 'DELETE' },
      `推文 ${tweet.id} 已删除。`,
      deleteMonth,
    );
    if (result && editingTweetId === tweet.id) {
      resetForm();
    }
  }

  async function handleRetranslate() {
    if (!editingTweet) return;
    setRetranslating(true);
    try {
      const response = await fetch(`/api/admin/tweets/${editingTweet.id}/retranslate`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const json = (await response.json()) as AdminResponse<{ month?: string }>;
      if (!response.ok || !json.ok) {
        throw new Error(unwrapError(json, '自动翻译失败。'));
      }
      await loadDashboard(activeGroupKey || json.data.month || selectedGroupKey);
      toast.success(`推文 ${editingTweet.id} 的自动译文已更新。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '自动翻译失败。');
    } finally {
      setRetranslating(false);
    }
  }

  async function runXSync(mode: 'recent' | 'backfill') {
    setSyncing(mode);
    try {
      const response = await fetch('/api/admin/tweets/sync/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ mode }),
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const json = (await response.json()) as AdminResponse<{
        fetched: number;
        created: number;
        updated: number;
        removed: number;
        hasMore: boolean;
        revalidated?: { revalidated: boolean };
      }>;
      if (!response.ok || !json.ok) throw new Error(unwrapError(json, 'X 同步失败。'));
      await loadDashboard(activeGroupKey || selectedGroupKey);
      const suffix = json.data.hasMore ? '，仍有历史内容待回填' : '';
      toast.success(`X 同步完成：新增 ${json.data.created}，更新 ${json.data.updated}，移除 ${json.data.removed}${suffix}。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'X 同步失败。');
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="min-h-[calc(100svh-3.5rem)] p-5 lg:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-sm text-muted-foreground">Tweets / <span className="font-mono text-xs">{targetMonthPath}</span></p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">推文编辑</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={syncing !== null} onClick={() => void runXSync('recent')}>
            {syncing === 'recent' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncing === 'recent' ? '同步中…' : '同步 X'}
          </Button>
          <Button type="button" variant="ghost" disabled={syncing !== null} onClick={() => void runXSync('backfill')}>
            {syncing === 'backfill' ? <Loader2 className="animate-spin" /> : <History />}
            {syncing === 'backfill' ? '回填中…' : '继续回填'}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="lg:border-r lg:pr-5"><MonthIndexPanel
          groups={groups}
          activeGroupKey={activeGroupKey}
          granularity={granularity}
          onGranularityChange={(value) => {
            setGranularity(value);
            setFilter('all');
          }}
          onSelect={(key) => {
            setSelectedGroupKey(key);
            setFilter('all');
          }}
        /></aside>

        <section className="min-w-0">
          {composerMode ? (
            <ComposerPanel
              mode={composerMode}
              form={form}
              onChange={updateField}
              editingTweet={editingTweet}
              translationTargets={translationTargets as unknown as string[]}
              saving={saving}
              retranslating={retranslating}
              onSubmit={() => void handleSubmit()}
              onCancel={resetForm}
              onDelete={
                composerMode === 'edit' && editingTweet
                  ? () => setPendingDelete(editingTweet)
                  : undefined
              }
              onRetranslate={composerMode === 'edit' ? () => void handleRetranslate() : undefined}
            />
          ) : null}

          <TweetListPanel
            monthLabel={activeGroup ? formatDateGroupLabel(activeGroup.key, granularity) : '推文列表'}
            filter={filter}
            onFilterChange={setFilter}
            onCreate={startCreate}
            loading={loading}
            emptyHint={
              !activeGroup
                ? '当前还没有任何时间范围数据，点击右上角“+”开始写第一条。'
                : '当前时间范围在此筛选条件下没有推文。'
            }
            tweets={filteredTweets}
            onEdit={startEdit}
            onDelete={(tweet) => setPendingDelete(tweet)}
          />
        </section>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除推文</AlertDialogTitle>
            <AlertDialogDescription>
              推文 {pendingDelete?.id}（当前可见性：{pendingDelete ? VISIBILITY_LABELS[(pendingDelete.visibility ?? 'public') as TweetVisibility] : ''}）将被永久删除。该操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
