'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, Copy, KeyRound, QrCode } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { adminRequest } from '@/lib/admin-api/client';
import { useI18n } from '@/components/i18n/locale-provider';
import LocaleSwitcher from '@/components/i18n/locale-switcher';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type Enrollment = { email: string; secret: string; uri: string };

export default function ActivationPageClient() {
  const router = useRouter();
  const { t } = useI18n();
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
    void import('qrcode')
      .then((QRCode) => QRCode.toDataURL(enrollment.uri, { margin: 1, width: 256 }))
      .then((dataUrl) => {
        if (active) setQrCode(dataUrl);
      })
      .catch(() => toast.error(t('auth.qrError')));
    return () => {
      active = false;
    };
  }, [enrollment, t]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await adminRequest<{ email: string; totpSecret: string; totpUri: string }>(
        '/api/auth/invitations/activate',
        { method: 'POST', body: { phase: 'start', token, password } },
      );
      setEnrollment({ email: data.email, secret: data.totpSecret, uri: data.totpUri });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t('auth.activationStartError'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await adminRequest<void>('/api/auth/invitations/activate', {
        method: 'POST',
        body: { phase: 'verify', totpToken: code },
      });
      router.push('/onboarding');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t('auth.invalidCode'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/20 px-4 py-8 sm:px-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LocaleSwitcher />
      </div>
      <main className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <Link
            href="/login"
            className="text-xs font-semibold uppercase tracking-[0.18em] text-brand focus-visible:ring-2"
          >
            ARSVINE ADMIN
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">{t('auth.activation')}</p>
        </div>
        <Card className="overflow-hidden">
          {!enrollment ? (
            <form onSubmit={start}>
              <input
                type="text"
                name="username"
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
              />
              <CardHeader className="border-b px-5 py-5 sm:px-7">
                <CardTitle>{t('auth.setPassword')}</CardTitle>
                <CardDescription>{t('auth.activationStep1')}</CardDescription>
              </CardHeader>
              <CardContent className="px-5 py-6 sm:px-7">
                <FieldGroup>
                  <Field data-invalid={(password.length > 0 && password.length < 14) || undefined}>
                    <FieldLabel htmlFor="password">{t('auth.newPassword')}</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-invalid={password.length > 0 && password.length < 14}
                    />
                    <FieldDescription>{t('auth.passwordHint')}</FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end border-t bg-muted/20 px-5 py-4 sm:px-7">
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={busy || !token || password.length < 14}
                >
                  {busy ? t('common.processing') : t('auth.bindAuthenticator')}
                </Button>
              </CardFooter>
            </form>
          ) : (
            <form onSubmit={verify}>
              <CardHeader className="border-b px-5 py-5 sm:px-7">
                <CardTitle>{t('auth.bindAuthenticatorTitle')}</CardTitle>
                <CardDescription>{t('auth.activationStep2')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 px-5 py-6 sm:px-7">
                <div className="rounded-xl border bg-brand/5 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <KeyRound className="text-brand" />
                    {t('auth.secretOnlyYou')}
                  </div>
                  <p className="mt-1 leading-6 text-muted-foreground">
                    {t('auth.secretHint', { email: enrollment.email })}
                  </p>
                </div>
                <div className="flex justify-center rounded-xl border bg-background p-4">
                  {qrCode ? (
                    <Image
                      src={qrCode}
                      alt={t('auth.qrAlt')}
                      width={192}
                      height={192}
                      unoptimized
                    />
                  ) : (
                    <QrCode
                      className="size-48 text-muted-foreground"
                      aria-label={t('auth.qrLoading')}
                    />
                  )}
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="totp-secret">{t('auth.manualSecret')}</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="totp-secret"
                        value={enrollment.secret}
                        readOnly
                        className="font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-10 shrink-0"
                        aria-label={t('auth.copySecret')}
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(enrollment.secret)
                            .then(() => toast.success(t('auth.secretCopied')))
                            .catch(() => toast.error(t('auth.copyFailed')))
                        }
                      >
                        <Copy />
                      </Button>
                    </div>
                  </Field>
                  <Field data-invalid={(code.length > 0 && code.length !== 6) || undefined}>
                    <FieldLabel htmlFor="totp">{t('auth.code')}</FieldLabel>
                    <Input
                      id="totp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      aria-invalid={code.length > 0 && code.length !== 6}
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end border-t bg-muted/20 px-5 py-4 sm:px-7">
                <Button type="submit" className="min-h-11" disabled={busy || code.length !== 6}>
                  {busy ? (
                    t('common.verifying')
                  ) : (
                    <>
                      <Check data-icon="inline-start" />
                      {t('auth.completeActivation')}
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}
