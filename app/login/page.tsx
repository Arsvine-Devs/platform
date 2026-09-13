'use client';

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type { LoginData } from '@/lib/admin-api/contracts';
import { useI18n } from '@/components/i18n/locale-provider';
import LocaleSwitcher from '@/components/i18n/locale-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);
  const devPreviewAvailable = process.env.NEXT_PUBLIC_ADMIN_DEV_LOGIN_BYPASS === '1';

  useEffect(() => {
    const timer = window.setTimeout(() => setWebAuthnSupported(browserSupportsWebAuthn()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleWebAuthnLogin() {
    setKeySubmitting(true);
    try {
      const options = await adminRequest<{
        ceremonyId: string;
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      }>('/api/admin/webauthn/authentication/options', { method: 'POST' });
      const authenticationResponse = await startAuthentication({ optionsJSON: options.options });
      await adminRequest<void>('/api/admin/webauthn/authentication/verify', {
        method: 'POST',
        body: { ceremonyId: options.ceremonyId, response: authenticationResponse },
      });
      router.push('/blog');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('auth.keyLoginError'));
    } finally {
      setKeySubmitting(false);
    }
  }

  async function handleLegacyLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const data = await adminRequest<LoginData>('/api/admin/login', {
        method: 'POST',
        body: { email, password, totpToken },
      });
      router.push(data.needsWebAuthnSetup ? '/security?setup=1' : '/blog');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('auth.loginError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDevelopmentLogin() {
    setDevSubmitting(true);
    try {
      await adminRequest<{ email: string; role: 'owner'; developmentBypass: true }>(
        '/api/admin/dev-login',
        { method: 'POST' },
      );
      router.push('/library');
    } catch (error) {
      if (isAdminApiError(error) && error.status === 404) toast.error(t('auth.devPreviewDisabled'));
      else toast.error(error instanceof Error ? error.message : t('auth.devPreviewDisabled'));
    } finally {
      setDevSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/20 px-4 py-8 sm:px-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LocaleSwitcher />
      </div>
      <main className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            ARSVINE ADMIN
          </p>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
            {t('auth.welcome')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.chooseLogin')}</p>
        </div>
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-card px-5 py-5 sm:px-7">
            <CardDescription>{t('auth.secureLogin')}</CardDescription>
            <CardTitle>{t('auth.enterWorkspace')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 px-5 py-6 sm:px-7">
            <section className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="text-brand" />
                {t('auth.ownerKey')}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('auth.ownerKeyDescription')}
              </p>
              <Button
                type="button"
                className="mt-4 min-h-11 w-full"
                onClick={() => void handleWebAuthnLogin()}
                disabled={keySubmitting || webAuthnSupported === false}
              >
                {keySubmitting ? (
                  <>
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                    {t('auth.verifying')}
                  </>
                ) : (
                  <>
                    <KeyRound />
                    {t('auth.useKey')}
                  </>
                )}
              </Button>
              {webAuthnSupported === false ? (
                <p className="mt-3 text-xs text-destructive" role="alert">
                  {t('auth.unsupportedWebAuthn')}
                </p>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {t('auth.migrationHint')}
              </p>
            </section>
            <div className="relative flex items-center">
              <div className="h-px flex-1 bg-border" />
              <span className="px-3 text-xs text-muted-foreground">
                {t('auth.editorMigration')}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={handleLegacyLogin} className="grid gap-4">
              <FieldSet>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="email">{t('auth.email')}</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="totp">{t('auth.totp')}</FieldLabel>
                    <Input
                      id="totp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={totpToken}
                      maxLength={6}
                      onChange={(event) =>
                        setTotpToken(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
              <Button
                type="submit"
                variant="outline"
                disabled={submitting}
                className="min-h-11 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                    {t('auth.loggingIn')}
                  </>
                ) : (
                  <>
                    <LogIn />
                    {t('auth.useCredentials')}
                  </>
                )}
              </Button>
            </form>
            {devPreviewAvailable ? (
              <>
                <Separator />
                <section className="rounded-2xl border border-dashed border-brand/50 bg-brand/5 p-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="rounded-full bg-brand/15 px-2 py-1 text-xs text-brand">
                      {t('auth.devOnly')}
                    </span>
                    {t('auth.devPreview')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t('auth.devPreviewDescription')}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-4 min-h-11 w-full"
                    onClick={() => void handleDevelopmentLogin()}
                    disabled={devSubmitting}
                  >
                    {devSubmitting ? t('auth.devPreviewSigning') : t('auth.devPreviewButton')}
                  </Button>
                </section>
              </>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
