'use client';

import type { BlogFormState } from './blog-editor-panel';
import MdxEditor from './mdx-editor';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/components/i18n/locale-provider';

type BlogWritingPanelProps = {
  form: BlogFormState;
  documentKey: string;
  onChange: <K extends keyof BlogFormState>(key: K, value: BlogFormState[K]) => void;
  onEditorError?: (message: string) => void;
};

export default function BlogWritingPanel({ form, documentKey, onChange, onEditorError }: BlogWritingPanelProps) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label={`${form.locale} ${t('blog.writing')}`}>
      <header className="border-b px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{form.locale}</p><h2 className="mt-1 font-heading text-lg font-semibold">{t('blog.writing')}</h2></div>
          <span className="text-xs text-muted-foreground">{t('blog.markdown')}</span>
        </div>
        <FieldGroup className="mt-6">
          <Field><FieldLabel htmlFor="blog-title">{t('blog.heading')}</FieldLabel><Input id="blog-title" value={form.title} onChange={(event) => onChange('title', event.target.value)} className="h-11 text-base" placeholder={t('blog.headingPlaceholder')} /></Field>
          <Field><FieldLabel htmlFor="blog-excerpt">{t('blog.excerpt')}</FieldLabel><Textarea id="blog-excerpt" value={form.excerpt} onChange={(event) => onChange('excerpt', event.target.value)} rows={2} placeholder={t('blog.excerptPlaceholder')} /><FieldDescription>{t('blog.excerptHint')}</FieldDescription></Field>
          <Field><FieldLabel htmlFor="blog-tags">{t('blog.tags')}</FieldLabel><Input id="blog-tags" value={form.tags} onChange={(event) => onChange('tags', event.target.value)} placeholder={t('blog.tagsPlaceholder')} /></Field>
        </FieldGroup>
      </header>
      <div className="min-h-0 flex-1 p-2 sm:p-3">
        <MdxEditor
          key={documentKey}
          markdown={form.content}
          onChange={(value) => onChange('content', value)}
          onError={onEditorError}
          placeholder={t('blog.startWriting')}
          autoFocus={Boolean(form.slug)}
        />
      </div>
      <footer className="border-t px-5 py-3 text-xs text-muted-foreground sm:px-7">
        {t('blog.editorHint')}
      </footer>
    </section>
  );
}
