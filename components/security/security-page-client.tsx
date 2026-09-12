'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type Credential = {
  id: string;
  label: string;
  aaguid: string;
  attestationFormat: string;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

type SecurityData = { authMethod: 'password+totp' | 'webauthn'; credentials: Credential[] };
type SecurityResponse = { ok: boolean; data?: SecurityData; error?: { code?: string; message: string } };
type RegistrationOptionsResponse = { ok: boolean; data?: { ceremonyId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }; error?: { message: string } };

function formatDate(value: string | null) {
  if (!value) return '尚未使用';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export default function SecurityPageClient({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [data, setData] = useState<SecurityData | null>(null);
  const [label, setLabel] = useState('');
  const [registering, setRegistering] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/security/credentials', { cache: 'no-store' });
    const json = await readJson<SecurityResponse>(response);
    if (response.status === 401 || response.status === 403) {
      router.push('/login');
      return;
    }
    if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error?.message ?? '无法读取安全设置。');
    setData(json.data);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => toast.error(error instanceof Error ? error.message : '无法读取安全设置。'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function register() {
    if (!label.trim()) {
      toast.error('请先输入安全密钥名称。');
      return;
    }
    setRegistering(true);
    try {
      const optionsResponse = await fetch('/api/admin/webauthn/registration/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ label }),
      });
      const optionsJson = await readJson<RegistrationOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !optionsJson?.ok || !optionsJson.data) throw new Error(optionsJson?.error?.message ?? '无法开始安全密钥注册。');

      const registrationResponse = await startRegistration({ optionsJSON: optionsJson.data.options });
      const verifyResponse = await fetch('/api/admin/webauthn/registration/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ ceremonyId: optionsJson.data.ceremonyId, response: registrationResponse }),
      });
      const verifyJson = await readJson<{ ok: boolean; error?: { message: string } }>(verifyResponse);
      if (!verifyResponse.ok || !verifyJson?.ok) throw new Error(verifyJson?.error?.message ?? '安全密钥注册失败。');
      toast.success('安全密钥已登记。');
      router.push('/security?enrolled=1');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '安全密钥注册失败。');
    } finally {
      setRegistering(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('确定撤销这枚安全密钥吗？撤销后所有现有会话都会结束。')) return;
    setRevoking(id);
    try {
      const response = await fetch(`/api/admin/security/credentials/${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      const json = await readJson<{ ok: boolean; error?: { message: string } }>(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? '无法撤销安全密钥。');
      toast.success('安全密钥已撤销，当前会话已结束。');
      router.push('/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法撤销安全密钥。');
    } finally {
      setRevoking(null);
    }
  }

  if (!data) return <main className="mx-auto w-full max-w-4xl p-5 lg:p-8"><Card><CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="animate-spin" />加载安全设置…</CardContent></Card></main>;

  const isLegacy = data.authMethod === 'password+totp';
  const onlyOne = data.credentials.length === 1;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-5 lg:p-8">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="text-primary" /><h1 className="text-2xl font-semibold tracking-tight">安全设置</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">Owner 的管理后台登录使用 FIDO2 安全密钥。密钥私钥不会上传到服务器。</p>
      </div>

      {isLegacy && <Card className="border-primary/40"><CardHeader><CardTitle>完成 Owner 安全密钥迁移</CardTitle><CardDescription>当前仍处于一次性密码 + TOTP 迁移模式。登记第一枚密钥后，Owner 的网页密码/TOTP 登录会立即关闭。</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">请插入支持 FIDO2、PIN 和用户验证的硬件安全密钥。系统会要求你为它设置一个便于识别的名称。</p></CardContent></Card>}

      {!isLegacy && onlyOne && <Card className="border-amber-500/50"><CardHeader><CardTitle>建议添加备用密钥</CardTitle><CardDescription>当前只有一枚有效安全密钥。丢失它后只能通过离线运维流程恢复账户。</CardDescription></CardHeader></Card>}

      <Card>
        <CardHeader><CardTitle>登记新的安全密钥</CardTitle><CardDescription>浏览器会提示使用跨平台安全密钥，并要求完成 PIN 和触摸验证。</CardDescription></CardHeader>
        <CardContent><FieldGroup><Field><FieldLabel htmlFor="credential-label">密钥名称</FieldLabel><Input id="credential-label" value={label} maxLength={64} placeholder="例如：日常 YubiKey" onChange={(event) => setLabel(event.target.value)} /><FieldDescription>名称只用于你在此页面识别密钥，不会参与认证。</FieldDescription></Field></FieldGroup></CardContent>
        <CardFooter><Button type="button" onClick={() => void register()} disabled={registering}>{registering ? <><Loader2 className="animate-spin" />验证中…</> : <><Plus />登记安全密钥</>}</Button></CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle>已登记的密钥</CardTitle><CardDescription>只有有效 credential 可以登录；撤销会使所有现有会话失效。</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.credentials.length === 0 ? <p className="text-sm text-muted-foreground">尚未登记安全密钥。</p> : data.credentials.map((credential) => <div key={credential.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium"><KeyRound className="size-4" />{credential.label}{credential.backedUp && <Badge variant="destructive">已备份</Badge>}</div><div className="mt-1 text-xs text-muted-foreground">设备：{credential.deviceType} · 证明：{credential.attestationFormat} · 传输：{credential.transports.join('、') || '未提供'}</div><div className="mt-1 font-mono text-xs text-muted-foreground">AAGUID {credential.aaguid} · 登记 {formatDate(credential.createdAt)} · 最近使用 {formatDate(credential.lastUsedAt)}</div></div><Button type="button" variant="outline" size="sm" onClick={() => void revoke(credential.id)} disabled={revoking !== null || data.credentials.length <= 1}><Trash2 />{revoking === credential.id ? '撤销中…' : '撤销'}</Button></div>)}
        </CardContent>
      </Card>
    </main>
  );
}
