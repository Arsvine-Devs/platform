'use client';

import { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReactNode } from 'react';
import { Separator } from '@/components/ui/separator';

type Props = { csrfToken: string; email: string };
type Form = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  contentUrl: string;
  tweetsUrl: string;
  secret: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  xTargetUserId: string;
  xTargetUsername: string;
  xBearerToken: string;
  xEnabled: boolean;
  xIncludeReplies: boolean;
  xIncludeRetweets: boolean;
  xConfigured: boolean;
};

const EMPTY: Form = {
  owner: '',
  repo: '',
  branch: 'main',
  token: '',
  contentUrl: '',
  tweetsUrl: '',
  secret: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  xTargetUserId: '',
  xTargetUsername: '',
  xBearerToken: '',
  xEnabled: false,
  xIncludeReplies: true,
  xIncludeRetweets: false,
  xConfigured: false,
};

export default function WorkspacePageClient({ csrfToken, email }: Props) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/admin/workspace');
      const json = await response.json();
      if (!response.ok || !json.ok) return;
      setForm((current) => ({
        ...current,
        owner: json.data.github.owner,
        repo: json.data.github.repo,
        branch: json.data.github.branch,
        contentUrl: json.data.revalidate.hasContentUrl ? '已配置' : '',
        tweetsUrl: json.data.revalidate.hasTweetsUrl ? '已配置' : '',
        secret: json.data.revalidate.hasSecret ? '已配置' : '',
        baseUrl: json.data.translation?.baseUrl ?? '',
        model: json.data.translation?.model ?? '',
        xTargetUserId: json.data.x?.targetUserId ?? '',
        xTargetUsername: json.data.x?.targetUsername ?? '',
        xEnabled: json.data.x?.enabled ?? Boolean(json.data.x?.hasBearerToken),
        xIncludeReplies: json.data.x?.includeReplies ?? true,
        xIncludeRetweets: json.data.x?.includeRetweets ?? false,
        xConfigured: Boolean(json.data.x?.hasBearerToken),
      }));
    })();
  }, []);

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const hasXInput = Boolean(form.xTargetUserId || form.xTargetUsername || form.xBearerToken || form.xEnabled || form.xConfigured);
      const x = hasXInput
        ? {
            enabled: form.xEnabled,
            targetUserId: form.xTargetUserId,
            targetUsername: form.xTargetUsername,
            bearerToken: form.xBearerToken,
            includeReplies: form.xIncludeReplies,
            includeRetweets: form.xIncludeRetweets,
          }
        : form.xConfigured
          ? null
          : undefined;
      const response = await fetch('/api/admin/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({
          github: { owner: form.owner, repo: form.repo, branch: form.branch, token: form.token },
          revalidate: {
            contentUrl: form.contentUrl === '已配置' ? '' : form.contentUrl,
            tweetsUrl: form.tweetsUrl === '已配置' ? '' : form.tweetsUrl,
            secret: form.secret === '已配置' ? '' : form.secret,
          },
          translation: form.baseUrl
            ? { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model }
            : undefined,
          ...(x === undefined ? {} : { x }),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error?.message);
      toast.success('私密工作区已保存。');
      setForm((current) => ({
        ...current,
        token: '',
        apiKey: '',
        secret: json.data.revalidate.hasSecret ? '已配置' : '',
        contentUrl: json.data.revalidate.hasContentUrl ? '已配置' : '',
        tweetsUrl: json.data.revalidate.hasTweetsUrl ? '已配置' : '',
        xBearerToken: '',
        xEnabled: Boolean(json.data.x?.enabled),
        xConfigured: Boolean(json.data.x?.hasBearerToken),
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl p-5 lg:p-10">
      <h1 className="text-3xl font-semibold tracking-tight">我的工作区</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        仓库、站点刷新、翻译和 X 来源配置仅用于你的请求，以加密形式保存。管理员无法查看这些配置或你的内容。
      </p>
      <section className="mt-10 grid gap-8">
        <div>
          <h2 className="text-lg font-medium">账户</h2>
          <p className="mt-2 text-sm text-muted-foreground">{email} · 密码与 TOTP 由账户安全流程管理。</p>
        </div>

        <Separator />

        <div className="grid gap-5">
          <div>
            <h2 className="text-lg font-medium">私有仓库</h2>
            <p className="mt-1 text-sm text-muted-foreground">使用可写入该内容仓库的细粒度 GitHub Token。</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.xEnabled} onChange={(e) => update('xEnabled', e.target.checked)} />
            启用 X 同步
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GitHub Owner"><Input value={form.owner} onChange={(e) => update('owner', e.target.value)} /></Field>
            <Field label="Repository"><Input value={form.repo} onChange={(e) => update('repo', e.target.value)} /></Field>
            <Field label="Branch"><Input value={form.branch} onChange={(e) => update('branch', e.target.value)} /></Field>
            <Field label="GitHub Token"><Input type="password" placeholder="留空以保留当前密钥" value={form.token} onChange={(e) => update('token', e.target.value)} /></Field>
          </div>
        </div>

        <Separator />

        <div className="grid gap-5">
          <div>
            <h2 className="text-lg font-medium">X 时间线来源</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              使用官方 X API 读取目标账户，再写入你的私有内容仓库。未配置 token 时不会调用 X；是否充值由你在 X Developer Console 中决定。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="X User ID"><Input value={form.xTargetUserId} onChange={(e) => update('xTargetUserId', e.target.value)} placeholder="例如 2244994945" /></Field>
            <Field label="X username"><Input value={form.xTargetUsername} onChange={(e) => update('xTargetUsername', e.target.value)} placeholder="不带 @" /></Field>
            <div className="sm:col-span-2">
              <Field label="X Bearer Token"><Input type="password" autoComplete="off" placeholder={form.xConfigured ? '留空以保留当前 token' : '留空以暂不启用'} value={form.xBearerToken} onChange={(e) => update('xBearerToken', e.target.value)} /></Field>
            </div>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.xIncludeReplies} onChange={(e) => update('xIncludeReplies', e.target.checked)} />
              同步 replies
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.xIncludeRetweets} onChange={(e) => update('xIncludeRetweets', e.target.checked)} />
              同步 retweets
            </label>
            <p className="text-xs text-muted-foreground">关闭时可以留空 Bearer Token；手动同步和每日同步都会跳过 X。启用后才要求有效 token。</p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-5">
          <div>
            <h2 className="text-lg font-medium">站点刷新</h2>
            <p className="mt-1 text-sm text-muted-foreground">留空的密钥字段会保留现有值。</p>
          </div>
          <div className="grid gap-4">
            <Field label="Blog 刷新 URL"><Input value={form.contentUrl} onFocus={() => form.contentUrl === '已配置' && update('contentUrl', '')} onChange={(e) => update('contentUrl', e.target.value)} /></Field>
            <Field label="Tweets 刷新 URL"><Input value={form.tweetsUrl} onFocus={() => form.tweetsUrl === '已配置' && update('tweetsUrl', '')} onChange={(e) => update('tweetsUrl', e.target.value)} /></Field>
            <Field label="刷新密钥"><Input type="password" value={form.secret} onFocus={() => form.secret === '已配置' && update('secret', '')} onChange={(e) => update('secret', e.target.value)} /></Field>
          </div>
        </div>

        <Separator />

        <div className="grid gap-5">
          <div>
            <h2 className="text-lg font-medium">个人翻译服务</h2>
            <p className="mt-1 text-sm text-muted-foreground">可选；配置后 Blog 和 Tweets 自动翻译只使用你的服务账户。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API Base URL"><Input value={form.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} /></Field>
            <Field label="模型"><Input value={form.model} onChange={(e) => update('model', e.target.value)} /></Field>
            <Field label="API Key"><Input type="password" placeholder="留空以保留当前密钥" value={form.apiKey} onChange={(e) => update('apiKey', e.target.value)} /></Field>
          </div>
        </div>

        <Button onClick={() => void save()} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Check className="animate-pulse" /> : <Save />}保存私密配置
        </Button>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}
