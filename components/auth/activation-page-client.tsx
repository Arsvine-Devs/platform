'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, KeyRound, QrCode } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type Enrollment = { email: string; secret: string; uri: string };

export default function ActivationPageClient() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/activate');
  }, [token]);

  useEffect(() => {
    if (!enrollment) return;
    let active = true;
    void import('qrcode').then((QRCode) => QRCode.toDataURL(enrollment.uri, { margin: 1, width: 256 })).then((dataUrl) => {
      if (active) setQrCode(dataUrl);
    }).catch(() => toast.error('无法生成二维码，请使用手动设置密钥。'));
    return () => { active = false; };
  }, [enrollment]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/auth/invitations/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'start', token, password }),
      });
      const json = await response.json() as { ok: boolean; data?: { email: string; totpSecret: string; totpUri: string }; error?: { message: string } };
      if (!response.ok || !json.ok || !json.data) throw new Error(json.error?.message ?? '无法开始激活。');
      setEnrollment({ email: json.data.email, secret: json.data.totpSecret, uri: json.data.totpUri });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法开始激活。');
    } finally { setBusy(false); }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/auth/invitations/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'verify', totpToken: code }),
      });
      const json = await response.json() as { ok: boolean; error?: { message: string } };
      if (!response.ok || !json.ok) throw new Error(json.error?.message ?? '验证码无效。');
      router.push('/onboarding');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '验证码无效。');
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4 sm:p-6">
    <Card className="w-full max-w-lg">
      {!enrollment ? <form onSubmit={start}>
        <CardHeader>
          <CardTitle>激活编辑账户</CardTitle>
          <CardDescription>第 1 步：设置一个至少 14 位的密码。下一步会在此设备上绑定身份验证器。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={password.length > 0 && password.length < 14 || undefined}>
              <FieldLabel htmlFor="password">新密码</FieldLabel>
              <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={password.length > 0 && password.length < 14} />
              <FieldDescription>请使用密码管理器生成并保存一个强密码。</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter><Button type="submit" disabled={busy || !token || password.length < 14}>{busy ? '处理中…' : '继续绑定身份验证器'}</Button></CardFooter>
      </form> : <form onSubmit={verify}>
        <CardHeader>
          <CardTitle>绑定身份验证器</CardTitle>
          <CardDescription>第 2 步：用身份验证器扫描二维码，然后输入当前显示的 6 位验证码。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><KeyRound />仅对你可见的设置密钥</div>
            <p className="mt-1 text-muted-foreground">不要将二维码或密钥发送给 Owner。它们仅用于你的 {enrollment.email} 账户。</p>
          </div>
          <div className="flex justify-center rounded-md border bg-background p-4">
            {qrCode ? <Image src={qrCode} alt="用于 ARSVINE Admin TOTP 的二维码" width={192} height={192} unoptimized /> : <QrCode className="size-48 text-muted-foreground" aria-label="正在生成二维码" />}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="totp-secret">无法扫描？手动输入设置密钥</FieldLabel>
              <div className="flex gap-2">
                <Input id="totp-secret" value={enrollment.secret} readOnly className="font-mono" />
                <Button type="button" variant="outline" size="icon" aria-label="复制设置密钥" onClick={() => void navigator.clipboard.writeText(enrollment.secret).then(() => toast.success('设置密钥已复制。'))}><Copy /></Button>
              </div>
            </Field>
            <Field data-invalid={code.length > 0 && code.length !== 6 || undefined}>
              <FieldLabel htmlFor="totp">6 位验证码</FieldLabel>
              <Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={code.length > 0 && code.length !== 6} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter><Button type="submit" disabled={busy || code.length !== 6}>{busy ? '验证中…' : <><Check data-icon="inline-start" />完成激活</>}</Button></CardFooter>
      </form>}
    </Card>
  </main>;
}
