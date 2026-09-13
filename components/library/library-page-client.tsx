'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, FileText, MessageCircle, Plus, Search } from 'lucide-react';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type { LibraryData, LibraryItem } from '@/lib/admin-api/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, PageFrame, PageHeader } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function typeLabel(type: LibraryItem['type'], t: Translate) {
  return type === 'blog' ? t('library.blog') : t('library.tweets');
}

function statusLabel(status: LibraryItem['status'], t: Translate) {
  return status === 'published' ? t('library.published') : t('library.draft');
}

function Detail({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col gap-6 p-5 sm:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{typeLabel(item.type, t)}</Badge>
          <Badge variant={item.status === 'published' ? 'secondary' : 'outline'}>{statusLabel(item.status, t)}</Badge>
        </div>
        <h2 className="mt-4 text-xl font-semibold leading-tight">{item.title}</h2>
      </div>
      <dl className="grid gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">{t('common.language')}</dt>
          <dd className="mt-1">{item.locale}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('common.updated')}</dt>
          <dd className="mt-1 font-mono text-xs">{formatDate(item.updatedAt)}</dd>
        </div>
      </dl>
      <Button nativeButton={false} className="mt-auto min-h-11" render={<Link href={item.href} />}>
        <ExternalLink data-icon="inline-start" />{t('library.openEditor')}
      </Button>
    </div>
  );
}

function ItemIcon({ type }: { type: LibraryItem['type'] }) {
  return type === 'blog' ? <FileText className="size-4 text-brand" aria-hidden="true" /> : <MessageCircle className="size-4 text-brand" aria-hidden="true" />;
}

export default function LibraryPageClient() {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | LibraryItem['type']>('all');
  const [status, setStatus] = useState<'all' | LibraryItem['status']>('all');
  const [language, setLanguage] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminRequest<LibraryData>('/api/admin/library');
        if (!active) return;
        setItems(data.items);
        setSelectedId(data.items[0]?.id);
      } catch (caught) {
        if (isAdminApiError(caught) && caught.status === 401) {
          router.push('/login');
          return;
        }
        if (active) setError(caught instanceof Error ? caught.message : t('library.unavailable'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, t]);

  const languages = useMemo(
    () => [...new Set(items.flatMap((item) => item.locale.split(' · ')))].sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return items.filter(
      (item) =>
        (type === 'all' || item.type === type) &&
        (status === 'all' || item.status === status) &&
        (language === 'all' || item.locale.split(' · ').includes(language)) &&
        `${item.title} ${item.locale}`.toLowerCase().includes(normalizedQuery),
    );
  }, [deferredQuery, items, language, status, type]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];

  function select(item: LibraryItem) {
    setSelectedId(item.id);
    setMobileDetailOpen(true);
  }

  return (
    <PageFrame size="full" className="gap-6 px-6 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t('library.title')}
        description={t('library.description')}
        actions={
          <Button nativeButton={false} className="min-h-11" render={<Link href="/blog" />}>
            <Plus data-icon="inline-start" />{t('library.newArticle')}
          </Button>
        }
      />

      {error ? (
        <EmptyState title={t('library.unavailable')} description={error} />
      ) : (
        <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0" aria-label={t('library.list')}>
            <div className="mb-4 flex flex-wrap gap-2 rounded-xl border bg-card p-4">
              <InputGroup className="min-w-56 flex-1">
                <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput aria-label={t('library.search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.search')} />
              </InputGroup>
              <Select value={type} onValueChange={(value) => setType((value ?? 'all') as typeof type)}>
                <SelectTrigger aria-label={t('library.type')} className="min-h-10 w-full sm:w-auto"><SelectValue>{(value) => value === 'blog' ? t('library.blog') : value === 'tweet' ? t('library.tweets') : t('library.allTypes')}</SelectValue></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">{t('library.allTypes')}</SelectItem><SelectItem value="blog">{t('library.blog')}</SelectItem><SelectItem value="tweet">{t('library.tweets')}</SelectItem></SelectGroup></SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => setStatus((value ?? 'all') as typeof status)}>
                <SelectTrigger aria-label={t('common.status')} className="min-h-10 w-full sm:w-auto"><SelectValue>{(value) => value === 'draft' ? t('library.draft') : value === 'published' ? t('library.published') : t('library.allStatuses')}</SelectValue></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">{t('library.allStatuses')}</SelectItem><SelectItem value="draft">{t('library.draft')}</SelectItem><SelectItem value="published">{t('library.published')}</SelectItem></SelectGroup></SelectContent>
              </Select>
              <Select value={language} onValueChange={(value) => setLanguage(value ?? 'all')}>
                <SelectTrigger aria-label={t('common.language')} className="min-h-10 w-full sm:w-auto"><SelectValue>{(value) => value && value !== 'all' ? value : t('library.allLanguages')}</SelectValue></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">{t('library.allLanguages')}</SelectItem>{languages.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>

            <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
              <Table>
                <TableHeader><TableRow><TableHead>{t('library.content')}</TableHead><TableHead>{t('library.type')}</TableHead><TableHead>{t('common.language')}</TableHead><TableHead>{t('library.updated')}</TableHead><TableHead>{t('common.status')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading ? Array.from({ length: 5 }).map((_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell></TableRow>) : null}
                  {!loading && filtered.map((item) => (
                    <TableRow key={item.id} data-state={selected?.id === item.id ? 'selected' : undefined}>
                      <TableCell className="max-w-sm font-medium">
                        <button type="button" className="flex min-h-11 w-full items-center gap-2 truncate text-left outline-none focus-visible:rounded-md focus-visible:ring-2" onClick={() => select(item)}>
                          <ItemIcon type={item.type} /><span className="truncate">{item.title}</span>
                        </button>
                      </TableCell>
                      <TableCell>{typeLabel(item.type, t)}</TableCell>
                      <TableCell className="text-muted-foreground">{item.locale}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
                      <TableCell><Badge variant={item.status === 'published' ? 'secondary' : 'outline'}>{statusLabel(item.status, t)}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {!loading && filtered.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">{t('library.noMatch')}</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-2 lg:hidden">
              {loading ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />) : null}
              {!loading && filtered.map((item) => (
                <button key={item.id} type="button" className="flex min-h-20 w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2" onClick={() => select(item)}>
                  <span className="flex items-start justify-between gap-3"><span className="flex min-w-0 items-center gap-2 font-medium"><ItemIcon type={item.type} /><span className="truncate">{item.title}</span></span><Badge variant={item.status === 'published' ? 'secondary' : 'outline'}>{statusLabel(item.status, t)}</Badge></span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{typeLabel(item.type, t)}</span><span>{item.locale}</span><span className="font-mono">{formatDate(item.updatedAt)}</span></span>
                </button>
              ))}
              {!loading && filtered.length === 0 ? <EmptyState title={t('library.noMatchTitle')} className="min-h-32" /> : null}
            </div>
          </section>

          <aside className="hidden min-h-80 rounded-xl border bg-card 2xl:block" aria-label={t('library.detail')}>
            {selected ? <Detail item={selected} /> : <p className="p-6 text-sm text-muted-foreground">{t('library.selectDetail')}</p>}
          </aside>
        </div>
      )}

      <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
        <SheetContent side="bottom" className="max-h-[88svh] overflow-auto">
          <SheetHeader><SheetTitle>{t('library.detail')}</SheetTitle><SheetDescription>{t('library.checkThenOpen')}</SheetDescription></SheetHeader>
          {selected ? <Detail item={selected} /> : null}
        </SheetContent>
      </Sheet>
    </PageFrame>
  );
}
