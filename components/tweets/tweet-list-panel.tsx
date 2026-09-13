'use client';

import { Plus } from 'lucide-react';

import { EmptyState, LoadingState } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TweetCard from './tweet-card';

import { TWEET_FILTERS } from './filter-labels';
import type { TweetFilter, TweetItem } from '../../lib/tweets-types';

type TweetListPanelProps = {
  monthLabel: string;
  filter: TweetFilter;
  onFilterChange: (filter: TweetFilter) => void;
  onCreate: () => void;
  loading: boolean;
  emptyHint: string;
  tweets: TweetItem[];
  onEdit: (tweet: TweetItem) => void;
  onDelete: (tweet: TweetItem) => void;
};

export default function TweetListPanel({
  monthLabel,
  filter,
  onFilterChange,
  onCreate,
  loading,
  emptyHint,
  tweets,
  onEdit,
  onDelete,
}: TweetListPanelProps) {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label={t('tweets.list')}>
      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-heading text-lg font-semibold">{monthLabel}</h2><p className="mt-1 text-xs text-muted-foreground">{t('tweets.listHint')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Tabs value={filter} onValueChange={(value) => onFilterChange((value ?? 'all') as TweetFilter)}><TabsList>{TWEET_FILTERS.map((item) => <TabsTrigger key={item} value={item}>{filterLabel(item, t)}</TabsTrigger>)}</TabsList></Tabs><Button type="button" className="min-h-10" onClick={onCreate}><Plus data-icon="inline-start" />{t('tweets.new')}</Button></div>
      </div>
      <div className="pt-4">{loading ? <LoadingState label={t('tweets.loading')} /> : tweets.length === 0 ? <EmptyState title={t('tweets.noMatch')} description={emptyHint} action={<Button type="button" variant="outline" className="min-h-10" onClick={onCreate}>{t('tweets.writeOne')}</Button>} className="min-h-32" /> : <div className="grid gap-3">{tweets.map((tweet) => <TweetCard key={tweet.id} tweet={tweet} onEdit={() => onEdit(tweet)} onDelete={() => onDelete(tweet)} />)}</div>}</div>
    </section>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function filterLabel(filter: TweetFilter, t: Translate) {
  if (filter === 'all') return t('tweets.all');
  if (filter === 'public') return t('tweets.public');
  if (filter === 'private') return t('tweets.private');
  if (filter === 'hidden') return t('tweets.hidden');
  return t('tweets.pinned');
}
