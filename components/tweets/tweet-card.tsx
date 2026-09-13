'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, EyeOff, Globe, Hash, Pin, Shield, Trash2 } from 'lucide-react';

import type { TweetItem, TweetVisibility } from '@/lib/tweets-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/components/i18n/locale-provider';

import { formatTimestamp } from './tweet-utils';
import { SITE_TWEET_LOCALES } from '../../lib/tweets-types';

type TweetCardProps = {
  tweet: TweetItem;
  onEdit: () => void;
  onDelete: () => void;
};

export default function TweetCard({ tweet, onEdit, onDelete }: TweetCardProps) {
  const { locale, t } = useI18n();
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const hasTranslations = Boolean(tweet.translations && Object.keys(tweet.translations).length > 0);
  const visibility: TweetVisibility = (tweet.visibility ?? 'public') as TweetVisibility;
  const isExternalSource = tweet.origin?.provider === 'x';

  return (
    <article id={`tweet-${tweet.id}`} tabIndex={-1} className="rounded-2xl border bg-card p-4 outline-none transition-colors focus-visible:ring-2 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><span className="font-mono text-sm font-medium">{tweet.id}</span><p className="mt-1 text-xs text-muted-foreground">{t('tweets.createdAt')} <time dateTime={tweet.createdAt}>{formatTimestamp(tweet.createdAt, locale)}</time> · {t('tweets.updatedAt')} {tweet.updatedAt ? <time dateTime={tweet.updatedAt}>{formatTimestamp(tweet.updatedAt, locale)}</time> : '—'}</p></div>
        <div className="flex flex-wrap items-center justify-end gap-1.5"><Badge variant="outline">{tweet.lang ?? 'zh-CN'}</Badge><Badge variant={visibilityBadgeVariant(visibility)}>{visibilityIcon(visibility)}{visibilityLabel(visibility, t)}</Badge>{tweet.pinned ? <Badge variant="default"><Pin />{t('tweets.pinned')}</Badge> : null}</div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{tweet.content}</p>
      {tweet.tags && tweet.tags.length > 0 ? <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">{tweet.tags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1"><Hash className="size-3" />{tag}</span>)}</div> : null}
      {isExternalSource ? <p className="mt-4 text-xs text-muted-foreground">{t('tweets.externalSource')}</p> : null}
      {hasTranslations ? <div className="mt-4 border-t pt-3"><Button type="button" variant="ghost" size="sm" className="min-h-10" aria-expanded={translationsOpen} onClick={() => setTranslationsOpen((value) => !value)}>{translationsOpen ? <ChevronUp /> : <ChevronDown />}{translationsOpen ? t('tweets.collapseTranslations') : t('tweets.translations')}</Button>{translationsOpen ? <div className="mt-3 grid gap-2">{SITE_TWEET_LOCALES.map((translationLocale) => { const translation = tweet.translations?.[translationLocale]; if (!translation) return null; return <div key={translationLocale} className="rounded-xl border bg-muted/30 p-3 text-sm"><div className="mb-1 flex items-center justify-between gap-2"><span className="font-medium">{translationLocale}</span>{translation.stale ? <Badge variant="secondary">{t('tweets.translationStale')}</Badge> : <span className="text-xs text-success">{t('tweets.translationFresh')}</span>}</div><p className="whitespace-pre-wrap leading-7">{translation.content}</p></div>; })}</div> : null}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><Button type="button" variant="outline" className="min-h-10" onClick={onEdit}>{t('common.edit')}</Button><Button type="button" variant="destructive" className="min-h-10" onClick={onDelete}><Trash2 />{t('common.delete')}</Button></div>
    </article>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function visibilityLabel(value: TweetVisibility, t: Translate) {
  if (value === 'public') return t('tweets.public');
  if (value === 'private') return t('tweets.private');
  return t('tweets.hidden');
}

function visibilityIcon(value: TweetVisibility) {
  if (value === 'public') return <Globe aria-hidden="true" />;
  if (value === 'private') return <Shield aria-hidden="true" />;
  return <EyeOff aria-hidden="true" />;
}

function visibilityBadgeVariant(value: TweetVisibility): 'default' | 'secondary' | 'destructive' {
  if (value === 'public') return 'default';
  if (value === 'private') return 'secondary';
  return 'destructive';
}
