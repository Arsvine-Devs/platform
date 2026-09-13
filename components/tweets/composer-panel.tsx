'use client';

import { Languages, Loader2, Save, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/components/i18n/locale-provider';

import { TWEET_LANGS, TWEET_VISIBILITIES } from './filter-labels';
import { getTranslationSummary } from './tweet-utils';
import type { TweetItem, TweetVisibility } from '../../lib/tweets-types';

export type TweetFormState = {
  content: string;
  lang: string;
  tags: string;
  visibility: TweetVisibility;
  pinned: boolean;
  createdAt: string;
  autoTranslate: boolean;
};

export const INITIAL_TWEET_FORM = (): TweetFormState => ({ content: '', lang: 'zh-CN', tags: '', visibility: 'public', pinned: false, createdAt: formatNowLocal(), autoTranslate: false });

function formatNowLocal() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

type ComposerPanelProps = {
  mode: 'create' | 'edit';
  form: TweetFormState;
  onChange: <K extends keyof TweetFormState>(key: K, value: TweetFormState[K]) => void;
  editingTweet: TweetItem | null;
  translationTargets: string[];
  saving: boolean;
  retranslating: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onRetranslate?: () => void;
};

export default function ComposerPanel({ mode, form, onChange, editingTweet, translationTargets, saving, retranslating, onSubmit, onCancel, onDelete, onRetranslate }: ComposerPanelProps) {
  const { t } = useI18n();
  const summary = editingTweet ? getTranslationSummary(editingTweet) : [];
  const hasStaleOrMissing = summary.some((item) => item.state !== 'fresh');
  const isExternalSource = editingTweet?.origin?.provider === 'x';

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="grid gap-5" aria-label={mode === 'edit' ? t('tweets.editTitle', { id: editingTweet?.id ?? '' }) : t('tweets.new')}>
      <div className="flex items-start justify-between gap-3 border-b pb-4"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{mode === 'edit' ? t('tweets.edit') : t('tweets.compose')}</p><h2 className="mt-1 font-heading text-lg font-semibold">{mode === 'edit' && editingTweet ? t('tweets.editTitle', { id: editingTweet.id }) : t('tweets.composeTitle')}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{isExternalSource ? t('tweets.externalHint') : mode === 'edit' ? t('tweets.localEditHint') : t('tweets.newHint')}</p></div><Button type="button" variant="ghost" className="min-h-10" disabled={saving || retranslating} onClick={onCancel}><X />{t('tweets.close')}</Button></div>
      <FieldGroup>
        <Field><FieldLabel htmlFor="tweet-content">{t('tweets.body')}</FieldLabel><Textarea id="tweet-content" value={form.content} disabled={isExternalSource} onChange={(event) => onChange('content', event.target.value)} placeholder={t('tweets.bodyPlaceholder')} rows={7} /><FieldDescription>{t('tweets.bodyHint')}</FieldDescription></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="tweet-created-at">{t('tweets.publishTime')}</FieldLabel><Input id="tweet-created-at" type="datetime-local" value={form.createdAt} disabled={mode === 'edit'} onChange={(event) => onChange('createdAt', event.target.value)} /></Field><Field><FieldLabel htmlFor="tweet-lang">{t('common.language')}</FieldLabel><Select disabled={isExternalSource} value={form.lang} onValueChange={(value) => onChange('lang', value ?? 'zh-CN')}><SelectTrigger id="tweet-lang"><SelectValue>{(value) => tweetLanguageLabel(value ?? 'zh-CN', t)}</SelectValue></SelectTrigger><SelectContent>{TWEET_LANGS.map((lang) => <SelectItem key={lang} value={lang}>{tweetLanguageLabel(lang, t)}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel htmlFor="tweet-visibility">{t('tweets.visibility')}</FieldLabel><Select value={form.visibility} onValueChange={(value) => onChange('visibility', (value ?? 'public') as TweetVisibility)}><SelectTrigger id="tweet-visibility"><SelectValue>{(value) => visibilityLabel((value ?? 'public') as TweetVisibility, t)}</SelectValue></SelectTrigger><SelectContent>{TWEET_VISIBILITIES.map((value) => <SelectItem key={value} value={value}>{visibilityLabel(value, t)}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel htmlFor="tweet-tags">{t('tweets.tags')}</FieldLabel><Input id="tweet-tags" value={form.tags} onChange={(event) => onChange('tags', event.target.value)} placeholder={t('tweets.tagsPlaceholder')} /></Field></div>
        <div className="grid gap-2"><div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3"><label htmlFor="tweet-pinned" className="text-sm">{t('tweets.pinned')}</label><Switch id="tweet-pinned" checked={form.pinned} onCheckedChange={(value) => onChange('pinned', value)} /></div>{mode === 'create' ? <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3"><label htmlFor="tweet-auto-translate" className="text-sm">{t('tweets.autoTranslate', { locales: translationTargets.join(' / ') })}</label><Switch id="tweet-auto-translate" checked={form.autoTranslate} onCheckedChange={(value) => onChange('autoTranslate', value)} /></div> : null}</div>
        {mode === 'create' ? <p className="text-sm text-muted-foreground">{form.autoTranslate ? t('tweets.autoTranslateHint') : t('tweets.noAutoTranslateHint')}</p> : null}
        {mode === 'edit' && editingTweet ? <div className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap gap-1.5">{summary.map((item) => <Badge key={item.locale} variant={item.state === 'fresh' ? 'default' : item.state === 'stale' ? 'secondary' : 'outline'}>{translationSummaryLabel(item.locale, item.state, t)}</Badge>)}</div>{hasStaleOrMissing && onRetranslate ? <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="outline" className="min-h-10" disabled={saving || retranslating} onClick={onRetranslate}>{retranslating ? <><Loader2 className="animate-spin motion-reduce:animate-none" />{t('tweets.retranslating')}</> : <><Languages />{t('tweets.retranslate')}</>}</Button><p className="text-xs text-muted-foreground">{t('tweets.retranslateHint')}</p></div> : <p className="mt-2 text-xs text-muted-foreground">{t('tweets.translationLatest')}</p>}</div> : null}
      </FieldGroup>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center"><Button type="submit" className="min-h-11" disabled={saving || retranslating || (mode === 'create' && !form.content.trim())}>{saving ? <><Loader2 className="animate-spin motion-reduce:animate-none" />{mode === 'create' && form.autoTranslate ? t('tweets.translatingCreate') : t('tweets.saving')}</> : <><Save />{mode === 'edit' ? t('tweets.save') : t('tweets.create')}</>}</Button><Button type="button" variant="outline" className="min-h-11" onClick={onCancel} disabled={saving || retranslating}>{t('common.cancel')}</Button>{mode === 'edit' && onDelete ? <Button type="button" variant="destructive" className="min-h-11 sm:ml-auto" disabled={saving || retranslating} onClick={onDelete}><Trash2 />{t('tweets.deleteOne')}</Button> : null}</div>
    </form>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function visibilityLabel(value: TweetVisibility, t: Translate) {
  if (value === 'public') return t('tweets.public');
  if (value === 'private') return t('tweets.private');
  return t('tweets.hidden');
}

function translationSummaryLabel(locale: string, state: 'fresh' | 'stale' | 'missing', t: Translate) {
  if (state === 'fresh') return `${locale} ${t('tweets.translationFresh')}`;
  if (state === 'stale') return `${locale} ${t('tweets.translationStale')}`;
  return `${locale} ${t('tweets.translationMissing')}`;
}

function tweetLanguageLabel(value: string, t: Translate) {
  const keys: Record<string, string> = { 'zh-CN': 'tweets.lang.zhCN', 'zh-TW': 'tweets.lang.zhTW', en: 'tweets.lang.en', ja: 'tweets.lang.ja', other: 'tweets.lang.other' };
  return t(keys[value] ?? 'tweets.lang.other');
}
