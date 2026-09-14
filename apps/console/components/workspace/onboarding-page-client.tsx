'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, CircleCheck, ExternalLink, GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type {
  WorkspaceSummary,
  WorkspaceUpdateInput,
  WorkspaceVerifyData,
} from '@/lib/admin-api/contracts';
import { ConfiguredBadge, PageFrame, PageHeader, SecretField } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
};

const STEPS = [
  'onboarding.github',
  'onboarding.revalidate',
  'onboarding.translation',
  'onboarding.check',
];
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
};

export default function OnboardingPageClient({
  csrfToken,
  developmentBypass = false,
}: {
  csrfToken: string;
  developmentBypass?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const githubTokenUrl = process.env.NEXT_PUBLIC_GITHUB_TOKEN_URL?.trim();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    void adminRequest<WorkspaceSummary>('/api/admin/workspace')
      .then((data) => {
        setSummary(data);
        setForm((current) => ({
          ...current,
          owner: data.github.owner,
          repo: data.github.repo,
          branch: data.github.branch || 'main',
          contentUrl: data.revalidate.contentUrl ?? '',
          tweetsUrl: data.revalidate.tweetsUrl ?? '',
          baseUrl: data.translation?.baseUrl ?? '',
          model: data.translation?.model ?? '',
        }));
      })
      .catch((caught) => {
        if (isAdminApiError(caught) && caught.status === 401) router.push('/login');
      });
  }, [router]);

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(body: WorkspaceUpdateInput, nextStep: number) {
    setBusy(true);
    try {
      const data = await adminRequest<WorkspaceSummary>('/api/admin/workspace', {
        method: 'PUT',
        csrfToken,
        body,
      });
      setSummary(data);
      setForm((current) => ({
        ...current,
        owner: data.github.owner,
        repo: data.github.repo,
        branch: data.github.branch,
        contentUrl: data.revalidate.contentUrl ?? current.contentUrl,
        tweetsUrl: data.revalidate.tweetsUrl ?? current.tweetsUrl,
        token: '',
        secret: '',
        apiKey: '',
      }));
      setStep(nextStep);
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(caught instanceof Error ? caught.message : t('workspace.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      await adminRequest<WorkspaceVerifyData>('/api/admin/workspace/verify', { method: 'POST' });
      setVerified(true);
      toast.success(t('onboarding.verified'));
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(caught instanceof Error ? caught.message : t('workspace.verifyError'));
    } finally {
      setBusy(false);
    }
  }

  const githubReady = Boolean(
    summary?.github.owner && summary?.github.repo && summary?.github.hasToken,
  );
  const revalidateReady = Boolean(
    summary?.revalidate.hasContentUrl && summary?.revalidate.hasSecret,
  );
  const translationReady = Boolean(summary?.translation?.baseUrl && summary.translation.hasApiKey);

  return (
    <PageFrame size="default">
      <PageHeader
        title={t('onboarding.title')}
        description={t('onboarding.description')}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            className="min-h-11"
            render={<Link href="/library" />}
          >
            {t('onboarding.later')}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label={t('onboarding.steps')}>
          <ol className="flex gap-2 overflow-x-auto lg:flex-col">
            {STEPS.map((key, index) => (
              <li key={key} className="shrink-0">
                <Button
                  type="button"
                  variant={step === index ? 'secondary' : 'ghost'}
                  className="min-h-11 w-full justify-start"
                  aria-current={step === index ? 'step' : undefined}
                  onClick={() => setStep(index)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs">
                    {index + 1}
                  </span>
                  {t(key)}
                </Button>
              </li>
            ))}
          </ol>
        </nav>

        <section
          className="overflow-hidden rounded-2xl border bg-card shadow-sm"
          aria-live="polite"
        >
          {step === 0 ? (
            <>
              <header className="border-b px-5 py-5 sm:px-7">
                <div className="flex items-center gap-2">
                  <GitBranch className="text-brand" />
                  <h2 className="font-heading text-lg font-semibold">
                    {t('onboarding.githubTitle')}
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('onboarding.githubDescription')}
                </p>
              </header>
              <div className="px-5 py-6 sm:px-7">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="github-owner">{t('workspace.githubOwner')}</FieldLabel>
                    <Input
                      id="github-owner"
                      value={form.owner}
                      onChange={(event) => update('owner', event.target.value)}
                      placeholder={t('onboarding.usernameOrOrg')}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="github-repo">{t('workspace.repositoryName')}</FieldLabel>
                    <Input
                      id="github-repo"
                      value={form.repo}
                      onChange={(event) => update('repo', event.target.value)}
                      placeholder={t('onboarding.repositoryName')}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="github-branch">{t('workspace.branch')}</FieldLabel>
                    <Input
                      id="github-branch"
                      value={form.branch}
                      onChange={(event) => update('branch', event.target.value)}
                    />
                  </Field>
                  <SecretField
                    label={t('onboarding.tokenLabel')}
                    configured={summary?.github.hasToken ?? false}
                    value={form.token}
                    onChange={(value) => update('token', value)}
                    placeholder={githubReady ? t('workspace.keepExisting') : 'github_pat_…'}
                    description={t('onboarding.tokenHint')}
                  />
                </FieldGroup>
              </div>
              <footer className="flex flex-col-reverse gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                {developmentBypass ? (
                  <span className="text-xs text-muted-foreground">{t('auth.devOnly')}</span>
                ) : githubTokenUrl ? (
                  <Button
                    nativeButton={false}
                    variant="link"
                    render={<a href={githubTokenUrl} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink data-icon="inline-start" />
                    {t('onboarding.createToken')}
                  </Button>
                ) : null}
                <Button
                  className="min-h-11"
                  disabled={busy || !form.owner || !form.repo || (!form.token && !githubReady)}
                  onClick={() =>
                    void save(
                      {
                        github: {
                          owner: form.owner,
                          repo: form.repo,
                          branch: form.branch,
                          token: form.token || undefined,
                        },
                      },
                      1,
                    )
                  }
                >
                  {busy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    <>
                      <ArrowRight data-icon="inline-end" />
                      {t('onboarding.continue')}
                    </>
                  )}
                </Button>
              </footer>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <header className="border-b px-5 py-5 sm:px-7">
                <h2 className="font-heading text-lg font-semibold">{t('onboarding.siteTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('onboarding.siteDescription')}
                </p>
              </header>
              <div className="px-5 py-6 sm:px-7">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="content-url">{t('workspace.blogRevalidate')}</FieldLabel>
                    <Input
                      id="content-url"
                      type="url"
                      value={form.contentUrl}
                      onChange={(event) => update('contentUrl', event.target.value)}
                      placeholder={
                        summary?.revalidate.hasContentUrl
                          ? t('workspace.keepExisting')
                          : 'https://…/api/revalidate'
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tweets-url">{t('workspace.tweetsRevalidate')}</FieldLabel>
                    <Input
                      id="tweets-url"
                      type="url"
                      value={form.tweetsUrl}
                      onChange={(event) => update('tweetsUrl', event.target.value)}
                      placeholder={
                        summary?.revalidate.hasTweetsUrl
                          ? t('workspace.keepExisting')
                          : 'https://…/api/revalidate/tweets'
                      }
                    />
                  </Field>
                  <SecretField
                    label={t('workspace.revalidateSecret')}
                    configured={summary?.revalidate.hasSecret ?? false}
                    value={form.secret}
                    onChange={(value) => update('secret', value)}
                    placeholder={
                      summary?.revalidate.hasSecret
                        ? t('workspace.keepExistingSecret')
                        : t('workspace.siteSecretPlaceholder')
                    }
                  />
                </FieldGroup>
              </div>
              <footer className="flex justify-between gap-3 border-t bg-muted/20 px-5 py-4 sm:px-7">
                <Button variant="outline" className="min-h-11" onClick={() => setStep(2)}>
                  {t('common.skip')}
                </Button>
                <Button
                  className="min-h-11"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      {
                        revalidate: {
                          contentUrl: form.contentUrl || undefined,
                          tweetsUrl: form.tweetsUrl || undefined,
                          secret: form.secret || undefined,
                        },
                      },
                      2,
                    )
                  }
                >
                  {busy ? t('common.saving') : t('onboarding.continue')}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </footer>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <header className="border-b px-5 py-5 sm:px-7">
                <h2 className="font-heading text-lg font-semibold">
                  {t('onboarding.translationTitle')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('onboarding.translationDescription')}
                </p>
              </header>
              <div className="px-5 py-6 sm:px-7">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="translation-url">{t('workspace.baseUrl')}</FieldLabel>
                    <Input
                      id="translation-url"
                      type="url"
                      value={form.baseUrl}
                      onChange={(event) => update('baseUrl', event.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="translation-model">{t('workspace.model')}</FieldLabel>
                    <Input
                      id="translation-model"
                      value={form.model}
                      onChange={(event) => update('model', event.target.value)}
                      placeholder={t('workspace.optional')}
                    />
                  </Field>
                  <SecretField
                    label={t('workspace.apiKey')}
                    configured={summary?.translation?.hasApiKey ?? false}
                    value={form.apiKey}
                    onChange={(value) => update('apiKey', value)}
                    placeholder={
                      translationReady ? t('workspace.keepExisting') : t('workspace.optional')
                    }
                  />
                  <FieldDescription>{t('onboarding.translationHint')}</FieldDescription>
                </FieldGroup>
              </div>
              <footer className="flex justify-between gap-3 border-t bg-muted/20 px-5 py-4 sm:px-7">
                <Button variant="outline" className="min-h-11" onClick={() => setStep(3)}>
                  {t('common.skip')}
                </Button>
                <Button
                  className="min-h-11"
                  disabled={
                    busy || (Boolean(form.baseUrl) !== Boolean(form.apiKey) && !translationReady)
                  }
                  onClick={() =>
                    void save(
                      form.baseUrl
                        ? {
                            translation: {
                              baseUrl: form.baseUrl,
                              apiKey: form.apiKey || undefined,
                              model: form.model || undefined,
                            },
                          }
                        : {},
                      3,
                    )
                  }
                >
                  {busy ? t('common.saving') : t('onboarding.continue')}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </footer>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <header className="border-b px-5 py-5 sm:px-7">
                <h2 className="font-heading text-lg font-semibold">{t('onboarding.checkTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('onboarding.checkDescription')}
                </p>
              </header>
              <div className="grid gap-3 px-5 py-6 sm:px-7">
                <SummaryRow
                  label={t('workspace.repository')}
                  value={
                    githubReady
                      ? `${summary?.github.owner}/${summary?.github.repo}`
                      : t('onboarding.notConfigured')
                  }
                  configured={githubReady}
                />
                <SummaryRow
                  label={t('workspace.revalidate')}
                  value={revalidateReady ? t('common.configured') : t('onboarding.laterSetting')}
                  configured={revalidateReady}
                />
                <SummaryRow
                  label={t('workspace.translation')}
                  value={translationReady ? t('common.configured') : t('onboarding.laterSetting')}
                  configured={translationReady}
                />
                {verified ? (
                  <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
                    <CircleCheck className="text-success" />
                    {t('onboarding.verified')}
                  </div>
                ) : null}
              </div>
              <footer className="flex flex-col-reverse gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <Button variant="outline" className="min-h-11" onClick={() => setStep(2)}>
                  {t('common.back')}
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={busy || !githubReady}
                    onClick={() => void verify()}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" />
                        {t('onboarding.checking')}
                      </>
                    ) : (
                      t('onboarding.verify')
                    )}
                  </Button>
                  <Button
                    nativeButton={false}
                    className="min-h-11"
                    disabled={!verified}
                    render={<Link href="/library" />}
                  >
                    <Check data-icon="inline-start" />
                    {t('onboarding.enterLibrary')}
                  </Button>
                </div>
              </footer>
            </>
          ) : null}
        </section>
      </div>
    </PageFrame>
  );
}

function SummaryRow({
  label,
  value,
  configured,
}: {
  label: string;
  value: string;
  configured: boolean;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {value}
        <ConfiguredBadge configured={configured} />
      </span>
    </div>
  );
}
