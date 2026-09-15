'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import { ConfirmAction, DetailSheet, PageFrame, PageHeader } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';

import ComposerPanel, { INITIAL_TWEET_FORM, type TweetFormState } from './composer-panel';
import MonthIndexPanel from './month-index-panel';
import RepositoryPanel from './repository-panel';
import StatsStrip from './stats-strip';
import TweetListPanel from './tweet-list-panel';
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
import type {
  CreateTweetInput,
  TweetFilter,
  TweetItem,
  TweetsDashboardData,
  TweetVisibility,
  UpdateTweetInput,
} from '../../lib/tweets-types';

type TweetsPageClientProps = {
  csrfToken: string;
  initialSelection?: { month?: string; id?: string };
};

function normalizeFormFromTweetItem(tweet: TweetItem): TweetFormState {
  return {
    content: tweet.content,
    lang: tweet.lang ?? 'zh-CN',
    tags: tagsToInput(tweet.tags),
    visibility: (tweet.visibility ?? 'public') as TweetVisibility,
    pinned: Boolean(tweet.pinned),
    createdAt: formatDateTimeLocal(tweet.createdAt),
  };
}

export default function TweetsPageClient({ csrfToken, initialSelection }: TweetsPageClientProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [data, setData] = useState<TweetsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granularity, setGranularity] = useState<DateGranularity>('month');
  const [selectedGroupKey, setSelectedGroupKey] = useState(initialSelection?.month ?? '');
  const [filter, setFilter] = useState<TweetFilter>('all');
  const [focusedTweetId, setFocusedTweetId] = useState(initialSelection?.id ?? '');
  const [editingTweetId, setEditingTweetId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<TweetFormState>(INITIAL_TWEET_FORM());
  const [pendingDelete, setPendingDelete] = useState<TweetItem | null>(null);

  const loadDashboard = useCallback(
    async (preferredGroupKey?: string) => {
      setLoading(true);
      try {
        const nextData = await adminRequest<TweetsDashboardData>('/api/control/tweets');
        setData(nextData);
        if (preferredGroupKey) setSelectedGroupKey(preferredGroupKey);
      } catch (caught) {
        if (isAdminApiError(caught) && caught.status === 401) {
          router.push('/login');
          return;
        }
        toast.error(caught instanceof Error ? caught.message : t('tweets.loadError'));
      } finally {
        setLoading(false);
      }
    },
    [router, t],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard(initialSelection?.month);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialSelection?.month, loadDashboard]);

  useEffect(() => {
    if (!focusedTweetId || !data) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`tweet-${focusedTweetId}`);
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      element?.scrollIntoView({ block: 'center', behavior });
      element?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, focusedTweetId]);

  const months = useMemo(() => data?.months ?? [], [data]);
  const groups = useMemo(
    () => groupTweetsByGranularity(months, granularity, locale),
    [months, granularity, locale],
  );
  const activeGroupKey = pickActiveDateGroup(groups, selectedGroupKey || null);
  const activeGroup = groups.find((group) => group.key === activeGroupKey) ?? null;
  const currentGroupTweets = activeGroup?.tweets ?? [];
  const filteredTweets = filterTweets(currentGroupTweets, filter);
  const allTweets = months.flatMap((month) => month.tweets);
  const editingTweet = editingTweetId
    ? (allTweets.find((tweet) => tweet.id === editingTweetId) ?? null)
    : null;
  const composerMonth = monthFromCreatedAt(form.createdAt);
  const targetMonthPath = composerMode
    ? composerMonth
      ? `tweets/${composerMonth}.json`
      : 'tweets/YYYY-MM.json'
    : activeGroup
      ? activeGroup.months.length === 1
        ? `tweets/${activeGroup.months[0]}.json`
        : t('tweets.fileCount', { count: activeGroup.months.length })
      : 'tweets/YYYY-MM.json';
  const stats = {
    total: allTweets.length,
    publicCount: allTweets.filter((tweet) => tweet.visibility === 'public').length,
    privateCount: allTweets.filter((tweet) => tweet.visibility === 'private').length,
    hiddenCount: allTweets.filter((tweet) => tweet.visibility === 'hidden').length,
    pinnedCount: allTweets.filter((tweet) => tweet.pinned).length,
  };

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
    setFocusedTweetId(tweet.id);
    setEditingTweetId(tweet.id);
    setComposerMode('edit');
    setForm(normalizeFormFromTweetItem(tweet));
  }

  async function runMutation(
    url: string,
    options: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown },
    successMessage: string,
    nextMonth?: string,
  ) {
    setSaving(true);
    try {
      await adminRequest<unknown>(url, { method: options.method, body: options.body, csrfToken });
      await loadDashboard(nextMonth);
      toast.success(successMessage);
      return true;
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return false;
      }
      toast.error(caught instanceof Error ? caught.message : t('tweets.actionError'));
      return false;
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
      if (
        await runMutation(
          `/api/control/tweets/${editingTweet.id}`,
          { method: 'PUT', body: payload },
          t('tweets.updatedSuccess'),
          editMonth,
        )
      )
        resetForm();
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
    };
    if (
      await runMutation(
        '/api/control/tweets',
        { method: 'POST', body: payload },
        t('tweets.createdSuccess'),
        targetMonth,
      )
    )
      resetForm();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const tweet = pendingDelete;
    setPendingDelete(null);
    const deleteMonth =
      editingTweetId === tweet.id
        ? monthFromCreatedAt(form.createdAt) || activeGroup?.months[0] || ''
        : activeGroup?.months[0] || '';
    const deleted = await runMutation(
      `/api/control/tweets/${tweet.id}`,
      { method: 'DELETE' },
      t('tweets.deleted', { id: tweet.id }),
      deleteMonth,
    );
    if (deleted && editingTweetId === tweet.id) resetForm();
  }

  return (
    <PageFrame size="full" className="gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`Tweets / ${targetMonthPath}`}
        title={t('tweets.title')}
        description={t('tweets.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" onClick={startCreate}>
              {t('tweets.new')}
            </Button>
          </div>
        }
      />
      <StatsStrip {...stats} />
      <div className="grid min-h-0 gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="min-h-0 rounded-2xl border bg-card p-4 shadow-sm lg:p-5">
          <MonthIndexPanel
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
          />
        </aside>
        <section className="min-w-0">
          <TweetListPanel
            monthLabel={
              activeGroup
                ? formatDateGroupLabel(activeGroup.key, granularity, locale)
                : t('tweets.list')
            }
            filter={filter}
            onFilterChange={setFilter}
            onCreate={startCreate}
            loading={loading}
            emptyHint={!activeGroup ? t('tweets.noData') : t('tweets.noFiltered')}
            tweets={filteredTweets}
            onEdit={startEdit}
            onDelete={(tweet) => setPendingDelete(tweet)}
          />
          <div className="mt-5">
            <RepositoryPanel data={data} targetPath={targetMonthPath} />
          </div>
        </section>
      </div>

      <DetailSheet
        open={composerMode !== null}
        onOpenChange={(open) => {
          if (!open && !saving) resetForm();
        }}
        title={
          composerMode === 'edit'
            ? t('tweets.editTitle', { id: editingTweet?.id ?? '' })
            : t('tweets.new')
        }
        description={
          editingTweet ? `${t('tweets.currentContent')}: ${editingTweet.id}` : t('tweets.saveHint')
        }
      >
        <ComposerPanel
          mode={composerMode === 'edit' ? 'edit' : 'create'}
          form={form}
          onChange={updateField}
          editingTweet={editingTweet}
          saving={saving}
          onSubmit={() => void handleSubmit()}
          onCancel={resetForm}
          onDelete={
            composerMode === 'edit' && editingTweet
              ? () => setPendingDelete(editingTweet)
              : undefined
          }
        />
      </DetailSheet>
      <ConfirmAction
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('tweets.deleteConfirmTitle')}
        description={t('tweets.deleteConfirmDescription', { id: pendingDelete?.id ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        busy={saving}
        onConfirm={() => void confirmDelete()}
      />
    </PageFrame>
  );
}
