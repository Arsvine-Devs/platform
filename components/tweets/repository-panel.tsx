'use client';

import { CodeXml, FileCode2, GitBranch, MapPin } from 'lucide-react';
import { useI18n } from '@/components/i18n/locale-provider';

import type { TweetsDashboardData } from '../../lib/tweets-types';

type RepositoryPanelProps = {
  data: TweetsDashboardData | null;
  targetPath: string;
};

export default function RepositoryPanel({ data, targetPath }: RepositoryPanelProps) {
  const { t } = useI18n();
  const repo = data?.repo;
  const stats = [
    {
      icon: <CodeXml />,
      label: t('workspace.repositoryName'),
      value: repo?.name ?? t('common.loading'),
    },
    {
      icon: <GitBranch />,
      label: t('workspace.branch'),
      value: repo?.branch ?? t('common.loading'),
    },
    {
      icon: <MapPin />,
      label: t('tweets.source'),
      value: repo?.originUrl ?? 'GitHub Contents API',
    },
    { icon: <FileCode2 />, label: t('tweets.currentFile'), value: targetPath },
  ];
  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      aria-label={t('tweets.repository')}
    >
      <div className="mb-4">
        <h2 className="font-heading text-base font-semibold">{t('tweets.repository')}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('tweets.repositoryHint')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {item.icon}
              {item.label}
            </div>
            <p className="mt-1 truncate text-sm font-medium" title={item.value}>
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
