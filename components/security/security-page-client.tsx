'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type { SecurityCredential, SecurityData } from '@/lib/admin-api/contracts';
import { AsyncAction, ConfirmAction, EmptyState, PageFrame, PageHeader } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type RegistrationOptions = {
  ceremonyId: string;
  options: Parameters<typeof startRegistration>[0]['optionsJSON'];
};

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16);
}

export default function SecurityPageClient({ csrfToken, developmentBypass = false }: { csrfToken: string; developmentBypass?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<SecurityData | null>(null);
  const [label, setLabel] = useState('');
  const [registering, setRegistering] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<SecurityCredential | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminRequest<SecurityData>('/api/admin/security/credentials'));
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) {
        router.push('/login');
        return;
      }
      throw caught;
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => toast.error(caught instanceof Error ? caught.message : t('security.loadError'))); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, t]);

  async function register() {
    if (!label.trim()) {
      toast.error(t('security.labelRequired'));
      return;
    }
    setRegistering(true);
    try {
      if (developmentBypass) {
        await adminRequest<{ credentialId: string; authMethod: 'webauthn' }>('/api/admin/webauthn/registration/verify', { method: 'POST', csrfToken, body: { development: true, label } });
        toast.success(t('security.registeredSuccess'));
        setLabel('');
        await load();
        return;
      }
      const options = await adminRequest<RegistrationOptions>('/api/admin/webauthn/registration/options', { method: 'POST', csrfToken, body: { label } });
      const response = await startRegistration({ optionsJSON: options.options });
      await adminRequest<{ credentialId: string; authMethod: 'webauthn' }>('/api/admin/webauthn/registration/verify', { method: 'POST', csrfToken, body: { ceremonyId: options.ceremonyId, response } });
      toast.success(t('security.registeredSuccess'));
      router.push('/security?enrolled=1');
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('security.registerError'));
    } finally {
      setRegistering(false);
    }
  }

  async function revoke() {
    if (!pendingRevoke) return;
    const credential = pendingRevoke;
    setPendingRevoke(null);
    setRevoking(credential.id);
    try {
      await adminRequest<void>(`/api/admin/security/credentials/${credential.id}`, { method: 'DELETE', csrfToken });
      toast.success(t('security.revokedSuccess'));
      router.push('/login');
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('security.revokeError'));
    } finally {
      setRevoking(null);
    }
  }

  if (!data) return <PageFrame size="default"><PageHeader title={t('security.title')} description={t('security.loadingDescription')} /><div className="rounded-2xl border bg-card p-8"><div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" />{t('common.loading')}</div></div></PageFrame>;

  const isLegacy = data.authMethod === 'password+totp';
  const onlyOne = data.credentials.length === 1;

  return (
    <PageFrame size="default">
      <PageHeader title={t('security.title')} icon={<ShieldCheck className="size-7" />} description={t('security.description')} />
      {isLegacy ? <section className="rounded-2xl border border-brand/40 bg-brand/5 p-5 sm:p-6"><h2 className="font-heading text-base font-semibold">{t('security.migrationTitle')}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('security.migrationDescription')}</p><p className="mt-3 text-sm leading-6">{t('security.migrationHint')}</p></section> : null}
      {!isLegacy && onlyOne ? <section className="rounded-2xl border border-warning/40 bg-warning/10 p-5 sm:p-6"><h2 className="font-heading text-base font-semibold">{t('security.backupTitle')}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('security.backupDescription')}</p></section> : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div><h2 className="font-heading text-base font-semibold">{t('security.registerTitle')}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t('security.registerDescription')}</p></div>
        <FieldGroup className="mt-5"><Field><FieldLabel htmlFor="credential-label">{t('security.label')}</FieldLabel><Input id="credential-label" value={label} maxLength={64} placeholder={t('security.labelPlaceholder')} onChange={(event) => setLabel(event.target.value)} /><FieldDescription>{t('security.labelHint')}</FieldDescription></Field></FieldGroup>
        <AsyncAction type="button" className="mt-5 min-h-11" busy={registering} busyLabel={t('security.registering')} onClick={() => void register()}><Plus />{t('security.register')}</AsyncAction>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div><h2 className="font-heading text-base font-semibold">{t('security.keysTitle')}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t('security.keysDescription')}</p></div>
        <div className="mt-5 grid gap-3">{data.credentials.length === 0 ? <EmptyState title={t('security.noKeys')} description={t('security.noKeysHint')} className="min-h-32" /> : data.credentials.map((credential) => <CredentialRow key={credential.id} credential={credential} disabled={revoking !== null || data.credentials.length <= 1} revoking={revoking === credential.id} onRevoke={() => setPendingRevoke(credential)} />)}</div>
      </section>

      <ConfirmAction open={pendingRevoke !== null} onOpenChange={(open) => { if (!open) setPendingRevoke(null); }} title={t('security.revokeTitle')} description={t('security.revokeDescription')} confirmLabel={t('security.revokeConfirm')} destructive busy={revoking !== null} onConfirm={() => void revoke()} />
    </PageFrame>
  );
}

function CredentialRow({ credential, disabled, revoking, onRevoke }: { credential: SecurityCredential; disabled: boolean; revoking: boolean; onRevoke: () => void }) {
  const { t } = useI18n();
  return <article className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium"><KeyRound className="size-4" aria-hidden="true" />{credential.label}{credential.backedUp ? <Badge variant="destructive">{t('security.backedUp')}</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{credential.deviceType} · {t('security.registered', { date: formatDate(credential.createdAt, t('security.notUsed')) })} · {t('security.lastUsed', { date: formatDate(credential.lastUsedAt, t('security.notUsed')) })}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer outline-none focus-visible:ring-2">{t('security.technical')}</summary><p className="mt-2 font-mono leading-5">{t('security.attestation')}: {credential.attestationFormat} · {t('security.transports')}: {credential.transports.join('、') || t('security.notProvided')}<br />AAGUID: {credential.aaguid}</p></details></div><Button type="button" variant="outline" className="min-h-10 sm:shrink-0" onClick={onRevoke} disabled={disabled}>{revoking ? <><Loader2 className="animate-spin" />{t('security.revoking')}</> : <><Trash2 />{t('security.revoke')}</>}</Button></article>;
}
