'use client';

import { Archive, EyeOff, Globe, Pin, Shield } from 'lucide-react';
import { useI18n } from '@/components/i18n/locale-provider';

type StatsStripProps = {
  total: number;
  publicCount: number;
  privateCount: number;
  hiddenCount: number;
  pinnedCount: number;
};

export default function StatsStrip({
  total,
  publicCount,
  privateCount,
  hiddenCount,
  pinnedCount,
}: StatsStripProps) {
  const { t } = useI18n();
  const items = [
    { icon: <Archive />, label: t('tweets.all'), value: total },
    { icon: <Globe />, label: t('tweets.public'), value: publicCount },
    { icon: <Shield />, label: t('tweets.private'), value: privateCount },
    { icon: <EyeOff />, label: t('tweets.hidden'), value: hiddenCount },
    { icon: <Pin />, label: t('tweets.pinned'), value: pinnedCount },
  ];
  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label={t('tweets.stats')}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {item.icon}
            {item.label}
          </div>
          <strong className="mt-1 block text-xl tabular-nums">{item.value}</strong>
        </div>
      ))}
    </section>
  );
}
