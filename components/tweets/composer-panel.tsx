'use client';

import { Loader2, Save, X, Trash2, Languages } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { LANG_LABELS, TWEET_LANGS, TWEET_VISIBILITIES } from './filter-labels';
import {
  formatTranslationSummaryItem,
  getTranslationSummary,
} from './tweet-utils';
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

export const INITIAL_TWEET_FORM = (): TweetFormState => ({
  content: '',
  lang: 'zh-CN',
  tags: '',
  visibility: 'public',
  pinned: false,
  createdAt: formatNowLocal(),
  autoTranslate: false,
});

function formatNowLocal() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
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

export default function ComposerPanel({
  mode,
  form,
  onChange,
  editingTweet,
  translationTargets,
  saving,
  retranslating,
  onSubmit,
  onCancel,
  onDelete,
  onRetranslate,
}: ComposerPanelProps) {
  const summary = editingTweet ? getTranslationSummary(editingTweet) : [];
  const hasStaleOrMissing = summary.some((item) => item.state !== 'fresh');
  const isExternalSource = editingTweet?.origin?.provider === 'x';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardDescription>{mode === 'edit' ? 'Editing' : 'New Tweet'}</CardDescription>
          <CardTitle>{mode === 'edit' && editingTweet ? `编辑 ${editingTweet.id}` : '编写推文'}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isExternalSource
              ? '这是 X 来源内容。原文由同步更新；此处可以管理标签、可见性、置顶和译文。'
              : mode === 'edit'
                ? '修改原文后，已有自动译文会被标记为过期，之后可手动重新生成。'
                : '先写原文，再决定发布时间、标签、置顶与是否自动翻译。'}
          </p>
        </div>
        <div className="flex gap-2">
          {mode === 'edit' && onDelete ? (
            <Button type="button" variant="destructive" size="sm" disabled={saving || retranslating} onClick={onDelete}>
              <Trash2 /> 删除这条推文
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={saving || retranslating} onClick={onCancel}>
            <X /> 关闭编辑板
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-5"
        >
          <FieldSet>
            <FieldGroup className="flex flex-col gap-4">
              <Field>
                <FieldLabel>正文</FieldLabel>
                <Textarea
                  value={form.content}
                  disabled={isExternalSource}
                  onChange={(event) => onChange('content', event.target.value)}
                  placeholder="写下这条推文的正文…"
                  rows={6}
                />
                <FieldDescription>
                  正文支持 <code>&lt;Explain note=&quot;注解&quot;&gt;被注解词&lt;/Explain&gt;</code> 句级注解；译文不会保留该标签。
                </FieldDescription>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>发布时间</FieldLabel>
                  <Input
                    type="datetime-local"
                    value={form.createdAt}
                    disabled={mode === 'edit'}
                    onChange={(event) => onChange('createdAt', event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>语言</FieldLabel>
                  <Select disabled={isExternalSource} value={form.lang} onValueChange={(value) => onChange('lang', value ?? 'zh-CN')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TWEET_LANGS.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {LANG_LABELS[lang] ?? lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>可见性</FieldLabel>
                  <Select
                    value={form.visibility}
                    onValueChange={(value) => onChange('visibility', (value ?? 'public') as TweetVisibility)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TWEET_VISIBILITIES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v === 'public' ? '公开' : v === 'private' ? '保护' : '隐藏'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>标签</FieldLabel>
                  <Input
                    value={form.tags}
                    onChange={(event) => onChange('tags', event.target.value)}
                    placeholder="例如：dev, notes, life"
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="tweet-pinned"
                    checked={form.pinned}
                    onCheckedChange={(value) => onChange('pinned', value)}
                  />
                  <Label htmlFor="tweet-pinned">置顶</Label>
                </div>
                {mode === 'create' ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="tweet-auto-translate"
                      checked={form.autoTranslate}
                      onCheckedChange={(value) => onChange('autoTranslate', value)}
                    />
                    <Label htmlFor="tweet-auto-translate">自动翻译</Label>
                  </div>
                ) : null}
              </div>

              {mode === 'create' ? (
                <p className="text-sm text-muted-foreground">
                  {form.autoTranslate
                    ? `保存时会同步生成 ${translationTargets.join(' / ')} 版本，并和原文一起写入 JSON。`
                    : '翻译关闭时只保存原文；以后仍可在编辑态手动生成自动译文。'}
                </p>
              ) : null}

              {mode === 'edit' && editingTweet ? (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {summary.map((item) => (
                      <Badge
                        key={item.locale}
                        variant={
                          item.state === 'fresh'
                            ? 'default'
                            : item.state === 'stale'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {formatTranslationSummaryItem(item.locale, item.state)}
                      </Badge>
                    ))}
                  </div>
                  {hasStaleOrMissing && onRetranslate ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving || retranslating}
                        onClick={onRetranslate}
                      >
                        {retranslating ? (
                          <>
                            <Loader2 className="animate-spin" /> 自动翻译中…
                          </>
                        ) : (
                          <>
                            <Languages /> 重新自动翻译
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        会按当前原文重新生成目标语言译文，并清除过期标记。
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">当前目标语言译文都是最新版本。</p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button type="submit" disabled={saving || retranslating}>
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {mode === 'create' && form.autoTranslate ? '翻译并创建中…' : '保存中…'}
                    </>
                  ) : (
                    <>
                      <Save />
                      {mode === 'edit' ? '保存修改' : '创建推文'}
                    </>
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={onCancel} disabled={saving || retranslating}>
                  取消
                </Button>
                <p className="text-xs text-muted-foreground">
                  保存会直接提交到私有内容仓库，并触发公开推文页刷新。
                </p>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}
