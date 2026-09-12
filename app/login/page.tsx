'use client';

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type LegacyLoginResponse =
  | { ok: true; data?: { role?: 'owner' | 'editor'; authMethod?: 'password+totp' | 'webauthn'; needsWebAuthnSetup?: boolean } }
  | { ok: false; error: { message: string } };

type WebAuthnOptionsResponse =
  | { ok: true; data: { ceremonyId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] } }
  | { ok: false; error: { code?: string; message: string } };

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setWebAuthnSupported(browserSupportsWebAuthn()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleWebAuthnLogin() {
    setKeySubmitting(true);
    try {
      const optionsResponse = await fetch('/api/admin/webauthn/authentication/options', { method: 'POST', cache: 'no-store' });
      const optionsJson = await readJson<WebAuthnOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !optionsJson || !optionsJson.ok) {
        throw new Error(optionsJson && !optionsJson.ok ? optionsJson.error.message : `无法开始安全密钥登录（HTTP ${optionsResponse.status}）。`);
      }

      const authenticationResponse = await startAuthentication({ optionsJSON: optionsJson.data.options });
      const verifyResponse = await fetch('/api/admin/webauthn/authentication/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ceremonyId: optionsJson.data.ceremonyId, response: authenticationResponse }),
      });
      const verifyJson = await readJson<{ ok: boolean; error?: { message: string } }>(verifyResponse);
      if (!verifyResponse.ok || !verifyJson?.ok) {
        throw new Error(verifyJson?.error?.message ?? `安全密钥登录失败（HTTP ${verifyResponse.status}）。`);
      }
      router.push('/blog');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '安全密钥登录失败。');
    } finally {
      setKeySubmitting(false);
    }
  }

  async function handleLegacyLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totpToken }),
      });
      const json = await readJson<LegacyLoginResponse>(response);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.ok ? '登录失败。' : json?.error.message ?? `登录失败（HTTP ${response.status}）。`);
      }
      router.push(json.data?.needsWebAuthnSetup ? '/security?setup=1' : '/blog');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登录失败。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardDescription>Admin Login</CardDescription>
          <CardTitle>ARSVINE ADMIN</CardTitle>
          <p className="text-sm text-muted-foreground">Owner 使用安全密钥登录；Editor 使用账户凭据登录。</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2 font-medium"><KeyRound />Owner 安全密钥登录</div>
            <p className="mb-4 text-sm text-muted-foreground">插入并触摸已登记的 FIDO2 安全密钥，按提示输入密钥 PIN。</p>
            <Button type="button" className="w-full" onClick={() => void handleWebAuthnLogin()} disabled={keySubmitting || webAuthnSupported === false}>
              {keySubmitting ? <><Loader2 className="animate-spin" />验证中…</> : <><KeyRound />使用安全密钥登录</>}
            </Button>
            {webAuthnSupported === false && <p className="mt-2 text-xs text-destructive">当前浏览器不支持 WebAuthn，请更换现代浏览器。</p>}
            <p className="mt-2 text-xs text-muted-foreground">首次迁移或尚未登记密钥时，请使用下方现有凭据完成一次设置。</p>
          </section>

          <div className="relative flex items-center"><div className="h-px flex-1 bg-border" /><span className="px-3 text-xs text-muted-foreground">Editor / 首次迁移</span><div className="h-px flex-1 bg-border" /></div>

          <form onSubmit={handleLegacyLogin} className="flex flex-col gap-4">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="totp">TOTP 验证码</FieldLabel>
                  <Input id="totp" inputMode="numeric" autoComplete="one-time-code" value={totpToken} maxLength={6} onChange={(event) => setTotpToken(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                </Field>
              </FieldGroup>
            </FieldSet>
            <Button type="submit" variant="outline" disabled={submitting} className="w-full">
              {submitting ? <><Loader2 className="animate-spin" />登录中…</> : <><LogIn />使用账户凭据登录</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
