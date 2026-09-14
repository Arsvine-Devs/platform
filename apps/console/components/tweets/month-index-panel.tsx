'use client';

import { Calendar } from 'lucide-react';
import { useI18n } from '@/components/i18n/locale-provider';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatTimestamp, type DateGranularity, type TweetDateGroup } from './tweet-utils';

type MonthIndexPanelProps = {
  groups: TweetDateGroup[];
  activeGroupKey: string;
  granularity: DateGranularity;
  onGranularityChange: (granularity: DateGranularity) => void;
  onSelect: (key: string) => void;
};

export default function MonthIndexPanel({
  groups,
  activeGroupKey,
  granularity,
  onGranularityChange,
  onSelect,
}: MonthIndexPanelProps) {
  const { locale, t } = useI18n();
  return (
    <section className="grid min-h-0 gap-4" aria-label={t('tweets.timeIndex')}>
      <div className="flex items-center gap-2">
        <Calendar className="size-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-heading text-base font-semibold">{t('tweets.timeIndex')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('tweets.timeIndexHint')}</p>
        </div>
      </div>
      <Tabs
        value={granularity}
        onValueChange={(value) => onGranularityChange((value ?? 'month') as DateGranularity)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="year">{t('blog.year')}</TabsTrigger>
          <TabsTrigger value="month">{t('blog.month')}</TabsTrigger>
          <TabsTrigger value="day">{t('blog.day')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {t('tweets.noRange')}
        </p>
      ) : (
        <ScrollArea className="max-h-[calc(100svh-18rem)] pr-2">
          <div className="grid gap-1">
            {groups.map((group) => {
              const active = group.key === activeGroupKey;
              return (
                <Button
                  key={group.key}
                  type="button"
                  variant={active ? 'secondary' : 'ghost'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(group.key)}
                  className="min-h-14 h-auto justify-start rounded-xl py-2.5 text-left"
                >
                  <span className="flex w-full flex-col items-start gap-0.5">
                    <span className="text-sm font-medium">{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.count} ·{' '}
                      {group.updatedAt ? (
                        <time dateTime={group.updatedAt}>
                          {formatTimestamp(group.updatedAt, locale)}
                        </time>
                      ) : (
                        '—'
                      )}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
