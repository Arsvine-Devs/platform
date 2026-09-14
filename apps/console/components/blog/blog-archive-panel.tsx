'use client';

import { useMemo, useState } from 'react';
import { Globe, Pin, Plus, Shield } from 'lucide-react';

import type { BlogIndexItem } from '@/lib/admin-api/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { BLOG_LOCALES, getLocaleLabel, type BlogLocale } from './blog-locale-labels';
import { useI18n } from '@/components/i18n/locale-provider';

export type { BlogIndexItem } from '@/lib/admin-api/contracts';

type BlogArchivePanelProps = {
  loading: boolean;
  items: BlogIndexItem[];
  selectedKey: string;
  onSelect: (item: BlogIndexItem, locale: BlogLocale) => void;
  onCreate: () => void;
};

type DateGranularity = 'year' | 'month' | 'day';

type BlogDateGroup = {
  key: string;
  label: string;
  items: BlogIndexItem[];
};

function getDateGroupKey(value: string, granularity: DateGranularity) {
  if (granularity === 'year') return value.slice(0, 4);
  if (granularity === 'day') return value.slice(0, 10);
  return value.slice(0, 7);
}

function formatDateGroupLabel(key: string, granularity: DateGranularity, locale: string) {
  const date = new Date(
    granularity === 'year'
      ? `${key}-01-01T00:00:00+08:00`
      : granularity === 'day'
        ? `${key}T00:00:00+08:00`
        : `${key}-01T00:00:00+08:00`,
  );
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    ...(granularity !== 'year' ? { month: 'long' } : {}),
    ...(granularity === 'day' ? { day: 'numeric' } : {}),
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

function getDefaultLocale(item: BlogIndexItem): BlogLocale {
  if (item.availableLocales.includes('zh-CN')) return 'zh-CN';
  if (item.availableLocales.includes('en')) return 'en';
  return item.availableLocales[0] ?? 'zh-CN';
}

function preferredTitle(item: BlogIndexItem) {
  return item.variants['zh-CN']?.title || item.variants.en?.title || item.slug;
}

export default function BlogArchivePanel({
  loading,
  items,
  selectedKey,
  onSelect,
  onCreate,
}: BlogArchivePanelProps) {
  const { locale: uiLocale, t } = useI18n();
  const [granularity, setGranularity] = useState<DateGranularity>('month');
  const selectedSlug = selectedKey.split(':')[0];

  const groups = useMemo(() => {
    const grouped = new Map<string, BlogDateGroup>();
    for (const item of items) {
      const key = getDateGroupKey(item.date, granularity);
      const current = grouped.get(key) ?? {
        key,
        label: formatDateGroupLabel(key, granularity, uiLocale),
        items: [],
      };
      current.items.push(item);
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((left, right) => right.key.localeCompare(left.key));
  }, [granularity, items, uiLocale]);

  return (
    <section className="flex min-h-0 flex-col gap-4" aria-label={t('blog.archive')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold">{t('blog.archive')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('blog.archiveHint')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onCreate}>
          <Plus data-icon="inline-start" />
          {t('blog.newShort')}
        </Button>
      </div>
      <Tabs
        value={granularity}
        onValueChange={(value) => setGranularity((value ?? 'month') as DateGranularity)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="year">{t('blog.year')}</TabsTrigger>
          <TabsTrigger value="month">{t('blog.month')}</TabsTrigger>
          <TabsTrigger value="day">{t('blog.day')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          {t('blog.noArticles')}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 pr-3">
          <div className="grid gap-5 pb-2">
            {groups.map((group) => (
              <section key={group.key} className="grid gap-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    {t('blog.articleCount', { count: group.items.length })}
                  </span>
                </div>
                {group.items.map((item) => {
                  const active = selectedSlug === item.slug;
                  return (
                    <article
                      key={item.slug}
                      className={`rounded-xl border p-3 transition-colors ${active ? 'border-brand/50 bg-accent/50' : 'bg-card hover:bg-muted/40'}`}
                    >
                      <button
                        type="button"
                        className="flex min-h-14 w-full flex-col gap-2 text-left outline-none focus-visible:rounded-md focus-visible:ring-2"
                        onClick={() => onSelect(item, getDefaultLocale(item))}
                        aria-current={active ? 'true' : undefined}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <strong className="truncate text-sm">{preferredTitle(item)}</strong>
                          <time
                            className="shrink-0 text-xs text-muted-foreground"
                            dateTime={item.date}
                          >
                            {item.date}
                          </time>
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={item.access.mode === 'totp' ? 'secondary' : 'outline'}>
                            {item.access.mode === 'totp' ? (
                              <>
                                <Shield />
                                {t('blog.protected')}
                              </>
                            ) : (
                              <>
                                <Globe />
                                {t('blog.public')}
                              </>
                            )}
                          </Badge>
                          {item.pinned ? (
                            <Badge variant="default">
                              <Pin />
                              {t('blog.pinned')}
                            </Badge>
                          ) : null}
                        </span>
                      </button>
                      <div
                        className="mt-3 flex flex-wrap gap-1.5"
                        aria-label={`${item.slug} ${t('blog.variants')}`}
                      >
                        {BLOG_LOCALES.map((locale) => {
                          if (!item.availableLocales.includes(locale)) return null;
                          const key = `${item.slug}:${locale}`;
                          return (
                            <Button
                              key={key}
                              type="button"
                              size="xs"
                              variant={selectedKey === key ? 'default' : 'outline'}
                              onClick={() => onSelect(item, locale)}
                            >
                              {getLocaleLabel(locale, uiLocale)}
                            </Button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
