'use client';

import { CheckCircle2, FilePenLine, PlusCircle } from 'lucide-react';

import { BLOG_LOCALES, getLocaleLabel, type BlogLocale } from './blog-locale-labels';
import type { BlogAccessMode } from '@/lib/admin-api/contracts';
import { AsyncAction } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type BlogFormState = {
  slug: string;
  locale: BlogLocale;
  title: string;
  excerpt: string;
  date: string;
  tags: string;
  pinned: boolean;
  accessMode: BlogAccessMode;
  accessGroup: string;
  originLocale: string;
  content: string;
};

type BlogEditorPanelProps = {
  form: BlogFormState;
  localeStates: Array<{ locale: BlogLocale; hasDraft: boolean; isPublished: boolean }>;
  onChange: <K extends keyof BlogFormState>(key: K, value: BlogFormState[K]) => void;
  publishing: boolean;
  batchPublishing: boolean;
  savingDraft: boolean;
  draftCount: number;
  onSaveDraft: () => void;
  onPublishAllDrafts: () => void;
  onSelectLocale: (locale: BlogLocale) => void;
  onPublish: () => void;
};

export const INITIAL_BLOG_FORM: BlogFormState = {
  slug: '',
  locale: 'zh-CN',
  title: '',
  excerpt: '',
  date: new Date().toISOString().slice(0, 10),
  tags: '',
  pinned: false,
  accessMode: 'public',
  accessGroup: '',
  originLocale: '',
  content: '',
};

export default function BlogEditorPanel({
  form,
  localeStates,
  onChange,
  publishing,
  batchPublishing,
  savingDraft,
  draftCount,
  onSaveDraft,
  onPublishAllDrafts,
  onSelectLocale,
  onPublish,
}: BlogEditorPanelProps) {
  const { locale: uiLocale, t } = useI18n();
  return (
    <aside className="grid content-start gap-4" aria-label={t('blog.settings')}>
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-semibold">{t('blog.settings')}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('blog.settingsDescription')}
            </p>
          </div>
          {form.pinned ? (
            <span className="text-xs font-medium text-brand">{t('blog.pinned')}</span>
          ) : null}
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="blog-slug">Slug</FieldLabel>
            <Input
              id="blog-slug"
              value={form.slug}
              onChange={(event) => onChange('slug', event.target.value)}
              placeholder="my-article"
            />
            <FieldDescription>{t('blog.slugHint')}</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="blog-date">{t('common.updated')}</FieldLabel>
              <Input
                id="blog-date"
                type="date"
                value={form.date}
                onChange={(event) => onChange('date', event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="blog-access">{t('blog.accessMode')}</FieldLabel>
              <Select
                value={form.accessMode}
                onValueChange={(value) =>
                  onChange('accessMode', (value ?? 'public') as BlogAccessMode)
                }
              >
                <SelectTrigger id="blog-access">
                  <SelectValue>
                    {(value) => (value === 'totp' ? t('blog.accessTotp') : t('blog.accessPublic'))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{t('blog.accessPublic')}</SelectItem>
                  <SelectItem value="totp">{t('blog.accessTotp')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {form.accessMode === 'totp' ? (
            <Field>
              <FieldLabel htmlFor="blog-access-group">{t('blog.accessGroup')}</FieldLabel>
              <Input
                id="blog-access-group"
                value={form.accessGroup}
                onChange={(event) => onChange('accessGroup', event.target.value)}
                placeholder="friends-a"
              />
              <FieldDescription>{t('blog.accessGroupHint')}</FieldDescription>
            </Field>
          ) : null}
          <div className="flex min-h-11 items-center gap-3 rounded-xl border px-3">
            <Checkbox
              id="blog-pinned"
              checked={form.pinned}
              onCheckedChange={(checked) => onChange('pinned', checked === true)}
            />
            <Label htmlFor="blog-pinned">{t('blog.pinInList')}</Label>
          </div>
        </FieldGroup>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5">
          <h2 className="font-heading text-base font-semibold">{t('blog.variants')}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('blog.variantsDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {localeStates.map((state) => {
            const active = state.locale === form.locale;
            const statusLabel = state.isPublished
              ? t('library.published')
              : state.hasDraft
                ? t('library.draft')
                : t('blog.emptyVariant');
            const StatusIcon = state.isPublished
              ? CheckCircle2
              : state.hasDraft
                ? FilePenLine
                : PlusCircle;
            return (
              <Button
                key={state.locale}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                className="min-h-10 justify-start gap-2"
                onClick={() => onSelectLocale(state.locale)}
              >
                <span>{getLocaleLabel(state.locale, uiLocale)}</span>
                <span className="inline-flex items-center gap-1 text-[11px] opacity-80">
                  <StatusIcon className="size-3.5" aria-hidden="true" />
                  {statusLabel}
                </span>
              </Button>
            );
          })}
        </div>
        <FieldGroup className="mt-5">
          <Field>
            <FieldLabel htmlFor="blog-locale">{t('blog.currentLocale')}</FieldLabel>
            <Select
              value={form.locale}
              onValueChange={(value) => onSelectLocale((value ?? 'zh-CN') as BlogLocale)}
            >
              <SelectTrigger id="blog-locale">
                <SelectValue>
                  {(value) =>
                    value
                      ? `${value} · ${getLocaleLabel(value as BlogLocale, uiLocale)}`
                      : t('blog.currentLocale')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BLOG_LOCALES.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale} · {getLocaleLabel(locale, uiLocale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="blog-origin">{t('blog.origin')}</FieldLabel>
            <Select
              value={form.originLocale}
              onValueChange={(value) => onChange('originLocale', value ?? '')}
            >
              <SelectTrigger id="blog-origin">
                <SelectValue placeholder={t('blog.originCurrent')}>
                  {(value) =>
                    value
                      ? `${value} · ${getLocaleLabel(value as BlogLocale, uiLocale)}`
                      : t('blog.originCurrent')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('blog.originCurrent')}</SelectItem>
                {BLOG_LOCALES.filter((locale) => locale !== form.locale).map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale} · {getLocaleLabel(locale, uiLocale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {t('blog.draftCount', { count: draftCount })}
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="font-heading text-base font-semibold">{t('blog.publishActions')}</h2>
        <div className="mt-4 grid gap-2">
          <AsyncAction
            type="button"
            className="min-h-11 w-full"
            busy={publishing}
            busyLabel={t('blog.publishing')}
            onClick={onPublish}
          >
            {t('blog.publishVariant')}
          </AsyncAction>
          <AsyncAction
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            busy={batchPublishing}
            busyLabel={t('blog.batchPublishing')}
            disabled={draftCount === 0}
            onClick={onPublishAllDrafts}
          >
            {t('blog.publishArticle', { count: draftCount })}
          </AsyncAction>
          <div className="pt-2">
            <AsyncAction
              type="button"
              variant="outline"
              className="min-h-10"
              busy={savingDraft}
              busyLabel={t('blog.savingDraft')}
              onClick={onSaveDraft}
            >
              {t('blog.saveDraft')}
            </AsyncAction>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('blog.publishHint')}</p>
      </section>
    </aside>
  );
}
