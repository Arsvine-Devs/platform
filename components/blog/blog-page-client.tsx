'use client';

import { useEffect, useSyncExternalStore, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PanelLeft, PanelRight } from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type {
  BlogIndexData,
  BlogPublishBatchInput,
  BlogPublishInput,
  BlogPublishResponse,
  BlogTranslateResponse,
  BlogVariantData,
} from '@/lib/admin-api/contracts';
import { DetailSheet, PageFrame, PageHeader } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import BlogArchivePanel, { type BlogIndexItem } from './blog-archive-panel';
import BlogEditorPanel, { INITIAL_BLOG_FORM, type BlogFormState } from './blog-editor-panel';
import BlogPreviewPanel from './blog-preview-panel';
import BlogWritingPanel from './blog-writing-panel';
import { BLOG_LOCALES, type BlogLocale } from './blog-locale-labels';

type BlogPageClientProps = {
  csrfToken: string;
  initialSelection?: { slug?: string; locale?: string };
};

type BlogDraft = BlogFormState & {
  savedAt: number;
};

const DRAFT_STORAGE_KEY = 'arsvine-admin.blog-drafts.v1';
const DRAFTS_UPDATED_EVENT = 'arsvine-admin:blog-drafts-updated';
const EMPTY_DRAFTS: Record<string, BlogDraft> = {};
let cachedDraftsRaw: string | null | undefined;
let cachedDraftsSnapshot: Record<string, BlogDraft> = EMPTY_DRAFTS;

function getDraftKey(slug: string, locale: BlogLocale) {
  return `${slug.trim().toLowerCase()}:${locale}`;
}

function hasMeaningfulFormContent(form: BlogFormState) {
  return Boolean(
    form.slug.trim() ||
    form.title.trim() ||
    form.excerpt.trim() ||
    form.tags.trim() ||
    form.content.trim(),
  );
}

function buildEmptyVariantForm(source: BlogFormState, locale: BlogLocale): BlogFormState {
  return {
    ...source,
    locale,
    title: '',
    excerpt: '',
    tags: '',
    originLocale: '',
    content: '',
  };
}

function optionalBlogLocale(value: string) {
  return BLOG_LOCALES.includes(value as BlogLocale) ? (value as BlogLocale) : undefined;
}

function readDraftsSnapshot(): Record<string, BlogDraft> {
  if (typeof window === 'undefined') {
    return EMPTY_DRAFTS;
  }

  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === cachedDraftsRaw) {
      return cachedDraftsSnapshot;
    }

    cachedDraftsRaw = raw;
    cachedDraftsSnapshot = raw ? (JSON.parse(raw) as Record<string, BlogDraft>) : EMPTY_DRAFTS;
    return cachedDraftsSnapshot;
  } catch {
    cachedDraftsRaw = null;
    cachedDraftsSnapshot = EMPTY_DRAFTS;
    return EMPTY_DRAFTS;
  }
}

function subscribeDrafts(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== DRAFT_STORAGE_KEY) return;
    onStoreChange();
  };
  const handleLocalUpdate = () => onStoreChange();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(DRAFTS_UPDATED_EVENT, handleLocalUpdate);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(DRAFTS_UPDATED_EVENT, handleLocalUpdate);
  };
}

export default function BlogPageClient({ csrfToken, initialSelection }: BlogPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [form, setForm] = useState<BlogFormState>(INITIAL_BLOG_FORM);
  const [items, setItems] = useState<BlogIndexItem[]>([]);
  const [panelMode, setPanelMode] = useState<'edit' | 'preview'>('edit');
  const drafts = useSyncExternalStore<Record<string, BlogDraft>>(
    subscribeDrafts,
    readDraftsSnapshot,
    () => EMPTY_DRAFTS,
  );
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [selectedKey, setSelectedKey] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [batchPublishing, setBatchPublishing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  function notifyError(error: unknown, fallback: string) {
    if (isAdminApiError(error) && error.status === 401) {
      router.push('/login');
      return;
    }
    toast.error(error instanceof Error ? error.message : fallback);
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadIndex(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The controller intentionally performs one initial load for this page instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistDrafts(nextDrafts: Record<string, BlogDraft>) {
    const serialized = JSON.stringify(nextDrafts);
    cachedDraftsRaw = serialized;
    cachedDraftsSnapshot = nextDrafts;
    window.localStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    window.dispatchEvent(new Event(DRAFTS_UPDATED_EVENT));
  }

  async function loadIndex(signal?: AbortSignal) {
    setLoadingIndex(true);
    try {
      const data = await adminRequest<BlogIndexData>('/api/admin/blog-index', { signal });
      setItems(data.posts);
      if (initialSelection?.slug) {
        const locale = BLOG_LOCALES.includes(initialSelection.locale as BlogLocale)
          ? (initialSelection.locale as BlogLocale)
          : 'zh-CN';
        void loadVariant(initialSelection.slug, locale);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (isAdminApiError(error) && error.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(error instanceof Error ? error.message : t('blog.loadError'));
    } finally {
      setLoadingIndex(false);
    }
  }

  function updateField<K extends keyof BlogFormState>(key: K, value: BlogFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setSelectedKey('');
    setForm(INITIAL_BLOG_FORM);
  }

  function getDraftCountForSlug(slug: string) {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedSlug) return 0;
    return Object.values(drafts).filter(
      (draft) => draft.slug.trim().toLowerCase() === normalizedSlug,
    ).length;
  }

  const draftCount = getDraftCountForSlug(form.slug);
  const normalizedCurrentSlug = form.slug.trim().toLowerCase();
  const publishedLocalesForSlug =
    items.find((item) => item.slug === normalizedCurrentSlug)?.availableLocales ?? [];
  const draftLocalesForSlug = Object.values(drafts)
    .filter((draft) => draft.slug.trim().toLowerCase() === normalizedCurrentSlug)
    .map((draft) => draft.locale);
  const localeStates = BLOG_LOCALES.map((locale) => ({
    locale,
    hasDraft: draftLocalesForSlug.includes(locale),
    isPublished: publishedLocalesForSlug.includes(locale),
  }));

  function saveDraft(currentForm: BlogFormState, options?: { silent?: boolean }) {
    const normalizedSlug = currentForm.slug.trim().toLowerCase();
    if (!normalizedSlug) {
      if (!options?.silent) {
        toast.error(t('blog.slugRequiredDraft'));
      }
      return false;
    }

    const nextDraft: BlogDraft = {
      ...currentForm,
      slug: normalizedSlug,
      savedAt: Date.now(),
    };

    const nextDrafts = { ...drafts };
    for (const [key, draft] of Object.entries(nextDrafts)) {
      if (draft.slug.trim().toLowerCase() !== normalizedSlug) continue;
      nextDrafts[key] = {
        ...draft,
        slug: normalizedSlug,
        date: currentForm.date,
        pinned: currentForm.pinned,
        accessMode: currentForm.accessMode,
        accessGroup: currentForm.accessGroup,
      };
    }

    nextDrafts[getDraftKey(normalizedSlug, currentForm.locale)] = nextDraft;
    persistDrafts(nextDrafts);

    if (!options?.silent) {
      toast.success(t('blog.savedDraft', { slug: normalizedSlug, locale: currentForm.locale }));
    }
    return true;
  }

  function clearDraftsForSlug(slug: string, locales?: BlogLocale[]) {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedSlug) return;

    const nextDrafts = { ...drafts };
    for (const [key, draft] of Object.entries(nextDrafts)) {
      if (draft.slug.trim().toLowerCase() !== normalizedSlug) continue;
      if (locales && !locales.includes(draft.locale)) continue;
      delete nextDrafts[key];
    }
    persistDrafts(nextDrafts);
  }

  async function loadVariant(slug: string, locale: BlogLocale) {
    const normalizedSlug = slug.trim().toLowerCase();
    const draftKey = getDraftKey(normalizedSlug, locale);
    const localDraft = drafts[draftKey];

    try {
      const data = await adminRequest<BlogVariantData>(
        `/api/admin/blog-variant?slug=${encodeURIComponent(normalizedSlug)}&locale=${encodeURIComponent(locale)}`,
      );
      const remoteForm: BlogFormState = {
        slug: data.slug,
        locale: data.locale,
        title: data.title,
        excerpt: data.excerpt,
        date: data.date,
        tags: data.tags.join(', '),
        pinned: data.pinned,
        accessMode: data.accessMode,
        accessGroup: data.accessGroup,
        originLocale: data.originLocale,
        content: data.content,
      };
      setSelectedKey(`${data.slug}:${data.locale}`);
      setForm(localDraft ?? remoteForm);
      if (localDraft) {
        toast.success(t('blog.loadDraft', { slug: normalizedSlug, locale }));
      }
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 404) {
        const fallback =
          localDraft ?? buildEmptyVariantForm({ ...form, slug: normalizedSlug }, locale);
        setSelectedKey(`${normalizedSlug}:${locale}`);
        setForm(fallback);
        return;
      }
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(caught instanceof Error ? caught.message : t('blog.variantLoadError'));
    }
  }

  async function handleLocaleSelect(locale: BlogLocale) {
    if (locale === form.locale) return;

    if (hasMeaningfulFormContent(form) && form.slug.trim()) {
      saveDraft(form, { silent: true });
    }

    if (!form.slug.trim()) {
      setForm((current) => ({ ...current, locale }));
      return;
    }

    await loadVariant(form.slug, locale);
  }

  async function handleSelectArchiveItem(item: BlogIndexItem, locale: BlogLocale) {
    if (hasMeaningfulFormContent(form) && form.slug.trim()) {
      saveDraft(form, { silent: true });
    }
    await loadVariant(item.slug, locale);
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const normalizedSlug = form.slug.trim().toLowerCase();
      const data = await adminRequest<BlogPublishResponse>('/api/admin/publish', {
        method: 'POST',
        csrfToken,
        body: {
          slug: normalizedSlug,
          locale: form.locale,
          title: form.title,
          excerpt: form.excerpt,
          date: form.date,
          tags: form.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          pinned: form.pinned,
          accessMode: form.accessMode,
          accessGroup: form.accessGroup,
          originLocale: optionalBlogLocale(form.originLocale),
          content: form.content,
        } satisfies BlogPublishInput,
      });
      toast.success(
        t('blog.publishedTo', {
          path: data.path || t('workspace.repository'),
          paths: data.revalidated?.paths.join(', ') || t('common.none'),
        }),
      );
      clearDraftsForSlug(normalizedSlug, [form.locale]);
      await loadIndex();
      setSelectedKey(`${normalizedSlug}:${form.locale}`);
    } catch (error) {
      notifyError(error, 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    try {
      saveDraft(form);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handlePublishAllDrafts() {
    const normalizedSlug = form.slug.trim().toLowerCase();
    if (!normalizedSlug) {
      toast.error(t('blog.slugRequired'));
      return;
    }

    const saved = saveDraft({ ...form, slug: normalizedSlug }, { silent: true });
    if (!saved) return;

    const slugDrafts = Object.values({
      ...drafts,
      [getDraftKey(normalizedSlug, form.locale)]: {
        ...form,
        slug: normalizedSlug,
        savedAt: Date.now(),
      },
    })
      .filter((draft) => draft.slug.trim().toLowerCase() === normalizedSlug)
      .sort((left, right) => left.savedAt - right.savedAt);

    if (slugDrafts.length === 0) {
      toast.error(t('blog.noDrafts'));
      return;
    }

    setBatchPublishing(true);
    try {
      const data = await adminRequest<BlogPublishResponse>('/api/admin/publish-batch', {
        method: 'POST',
        csrfToken,
        body: {
          slug: normalizedSlug,
          date: form.date,
          pinned: form.pinned,
          accessMode: form.accessMode,
          accessGroup: form.accessGroup,
          variants: slugDrafts.map((draft) => ({
            locale: draft.locale,
            title: draft.title,
            excerpt: draft.excerpt,
            tags: draft.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            content: draft.content,
            originLocale: optionalBlogLocale(draft.originLocale),
          })),
        } satisfies BlogPublishBatchInput,
      });
      clearDraftsForSlug(
        normalizedSlug,
        slugDrafts.map((draft) => draft.locale),
      );
      toast.success(
        t('blog.publishedBatch', {
          count: slugDrafts.length,
          paths: data.revalidated?.paths.join(', ') || t('common.none'),
        }),
      );
      await loadIndex();
      setSelectedKey(`${normalizedSlug}:${form.locale}`);
    } catch (error) {
      notifyError(error, t('blog.batchPublishError'));
    } finally {
      setBatchPublishing(false);
    }
  }

  async function handleTranslate() {
    if (form.locale !== 'zh-CN') {
      toast.error(t('blog.translationSourceError'));
      return;
    }
    if (!form.slug.trim()) {
      toast.error(t('blog.slugRequired'));
      return;
    }
    if (!form.title.trim() || !form.excerpt.trim() || !form.content.trim()) {
      toast.error(t('blog.translationFieldsRequired'));
      return;
    }

    const normalizedSlug = form.slug.trim().toLowerCase();
    saveDraft({ ...form, slug: normalizedSlug }, { silent: true });

    setTranslating(true);
    try {
      const data = await adminRequest<BlogTranslateResponse>('/api/admin/blog-translate', {
        method: 'POST',
        csrfToken,
        body: {
          sourceLocale: 'zh-CN',
          title: form.title,
          excerpt: form.excerpt,
          tags: form.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          content: form.content,
          targetLocales: ['zh-TW', 'en'],
        },
      });

      const nextDrafts = { ...drafts };
      nextDrafts[getDraftKey(normalizedSlug, form.locale)] = {
        ...form,
        slug: normalizedSlug,
        savedAt: Date.now(),
      };

      for (const variant of data.variants) {
        nextDrafts[getDraftKey(normalizedSlug, variant.locale)] = {
          slug: normalizedSlug,
          locale: variant.locale,
          title: variant.title,
          excerpt: variant.excerpt,
          date: form.date,
          tags: variant.tags.join(', '),
          pinned: form.pinned,
          accessMode: form.accessMode,
          accessGroup: form.accessGroup,
          originLocale: variant.originLocale,
          content: variant.content,
          savedAt: Date.now(),
        };
      }

      persistDrafts(nextDrafts);
      toast.success(
        t('blog.generatedDrafts', {
          locales: data.variants.map((item) => item.locale).join(' / '),
        }),
      );
    } catch (error) {
      notifyError(error, t('blog.translationError'));
    } finally {
      setTranslating(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const data = await adminRequest<{ revalidated: { paths: string[] } }>(
        '/api/admin/rebuild-index',
        {
          method: 'POST',
          csrfToken,
        },
      );
      toast.success(
        t('blog.indexRebuilt', { paths: data.revalidated.paths.join(', ') || t('common.none') }),
      );
      await loadIndex();
    } catch (error) {
      notifyError(error, t('blog.rebuildError'));
    } finally {
      setRebuilding(false);
    }
  }

  const documentKey = selectedKey || `new:${form.locale}`;

  return (
    <PageFrame size="full" className="gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={form.slug ? `Blog / ${form.slug}` : `Blog / ${t('blog.new')}`}
        title={t('blog.title')}
        description={t('blog.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 lg:hidden"
              onClick={() => setArchiveOpen(true)}
            >
              <PanelLeft />
              {t('blog.archive')}
            </Button>
            <Button
              type="button"
              variant={panelMode === 'edit' ? 'secondary' : 'outline'}
              size="sm"
              className="min-h-10"
              onClick={() => setPanelMode('edit')}
            >
              {t('common.write')}
            </Button>
            <Button
              type="button"
              variant={panelMode === 'preview' ? 'secondary' : 'outline'}
              size="sm"
              className="min-h-10"
              onClick={() => setPanelMode('preview')}
            >
              {t('common.preview')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 xl:hidden"
              onClick={() => setInspectorOpen(true)}
            >
              <PanelRight />
              {t('blog.settings')}
            </Button>
          </div>
        }
      />
      {editorError ? (
        <div
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
          role="alert"
        >
          {t('blog.editorParseError', { message: editorError })}
        </div>
      ) : null}
      <div className="grid min-h-[calc(100svh-13rem)] grid-cols-1 gap-5 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
        <aside className="hidden min-h-0 lg:block">
          <BlogArchivePanel
            loading={loadingIndex}
            items={items}
            selectedKey={selectedKey}
            onSelect={(item, locale) => void handleSelectArchiveItem(item, locale)}
            onCreate={resetForm}
          />
        </aside>
        <section className="min-h-0">
          {panelMode === 'edit' ? (
            <BlogWritingPanel
              form={form}
              documentKey={documentKey}
              onChange={updateField}
              onEditorError={setEditorError}
            />
          ) : (
            <BlogPreviewPanel content={form.content} />
          )}
        </section>
        <aside className="hidden min-h-0 xl:block">
          <BlogEditorPanel
            form={form}
            localeStates={localeStates}
            onChange={updateField}
            publishing={publishing}
            batchPublishing={batchPublishing}
            translating={translating}
            savingDraft={savingDraft}
            rebuilding={rebuilding}
            draftCount={draftCount}
            onTranslate={() => void handleTranslate()}
            onSaveDraft={() => void handleSaveDraft()}
            onPublishAllDrafts={() => void handlePublishAllDrafts()}
            onSelectLocale={(locale) => void handleLocaleSelect(locale)}
            onPublish={() => void handlePublish()}
            onRebuild={() => void handleRebuild()}
          />
        </aside>
      </div>
      <DetailSheet
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('blog.archive')}
        description={t('blog.archiveSelect')}
      >
        <BlogArchivePanel
          loading={loadingIndex}
          items={items}
          selectedKey={selectedKey}
          onSelect={(item, locale) => {
            setArchiveOpen(false);
            void handleSelectArchiveItem(item, locale);
          }}
          onCreate={() => {
            setArchiveOpen(false);
            resetForm();
          }}
        />
      </DetailSheet>
      <DetailSheet
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        title={t('blog.settings')}
        description={t('blog.inspectorDescription')}
      >
        <BlogEditorPanel
          form={form}
          localeStates={localeStates}
          onChange={updateField}
          publishing={publishing}
          batchPublishing={batchPublishing}
          translating={translating}
          savingDraft={savingDraft}
          rebuilding={rebuilding}
          draftCount={draftCount}
          onTranslate={() => void handleTranslate()}
          onSaveDraft={() => void handleSaveDraft()}
          onPublishAllDrafts={() => void handlePublishAllDrafts()}
          onSelectLocale={(locale) => void handleLocaleSelect(locale)}
          onPublish={() => void handlePublish()}
          onRebuild={() => void handleRebuild()}
        />
      </DetailSheet>
    </PageFrame>
  );
}
