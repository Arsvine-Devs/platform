'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { EmptyState } from '@/components/admin/blocks';
import { buildPreviewContent, hasUnsupportedMdx, sanitizeUrl } from './blog-preview-utils';
import { useI18n } from '@/components/i18n/locale-provider';

type BlogPreviewPanelProps = {
  content: string;
};

export default function BlogPreviewPanel({ content }: BlogPreviewPanelProps) {
  const { t } = useI18n();
  const preview = useMemo(() => buildPreviewContent(content, t('blog.previewEmpty')), [content, t]);
  const unsupported = useMemo(() => hasUnsupportedMdx(content), [content]);

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
      aria-label={t('blog.preview')}
    >
      <header className="flex items-start justify-between gap-3 border-b px-5 py-5 sm:px-7">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t('common.preview')}
          </p>
          <h2 className="mt-1 font-heading text-lg font-semibold">{t('blog.preview')}</h2>
        </div>
        <span className="text-xs text-muted-foreground">{t('blog.previewSecurity')}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-7">
        {unsupported ? (
          <div className="mb-5">
            <EmptyState
              title={t('blog.unknownMdx')}
              description={t('blog.unknownMdxHint')}
              className="min-h-24 p-4"
            />
          </div>
        ) : null}
        <article className="max-w-prose space-y-4 text-sm leading-7 text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-semibold tracking-tight">{children}</h3>
              ),
              p: ({ children }) => <p className="whitespace-pre-wrap leading-7">{children}</p>,
              ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-brand pl-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
                  {children}
                </code>
              ),
              hr: () => <hr className="border-border" />,
              a: ({ href, children }) => {
                const safe = sanitizeUrl(href);
                if (!safe)
                  return <span className="text-muted-foreground line-through">{children}</span>;
                return (
                  <a
                    href={safe}
                    className="text-brand underline underline-offset-4"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                );
              },
              img: ({ src, alt }) => {
                const safe = sanitizeUrl(src);
                if (!safe)
                  return <span className="text-muted-foreground italic">[blocked image]</span>;
                // The preview accepts arbitrary sanitized Markdown image URLs.
                // oxlint-disable-next-line nextjs/no-img-element -- next/image cannot represent this URL boundary.
                return <img src={safe} alt={alt ?? ''} className="max-w-full rounded-xl" />;
              },
            }}
          >
            {preview}
          </ReactMarkdown>
        </article>
      </div>
    </section>
  );
}
