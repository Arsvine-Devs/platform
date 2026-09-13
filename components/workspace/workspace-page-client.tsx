'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  CodeXml,
  GitBranch,
  Languages,
  Link2,
  Loader2,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type {
  WorkspaceSummary,
  WorkspaceUpdateInput,
  WorkspaceVerifyData,
} from '@/lib/admin-api/contracts';
import { useI18n } from '@/components/i18n/locale-provider';
import {
  AsyncAction,
  ConfiguredBadge,
  DetailSheet,
  EmptyState,
  PageFrame,
  PageHeader,
  SecretField,
  SettingsSection,
  SettingsSummaryRow,
} from '@/components/admin/blocks';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

type Props = { csrfToken: string; email: string };

type WorkspaceForm = {
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
  xSyncMethod: 'none' | 'api';
  xIncludeReplies: boolean;
  xIncludeRetweets: boolean;
};

const EMPTY_FORM: WorkspaceForm = {
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
  xSyncMethod: 'none',
  xIncludeReplies: true,
  xIncludeRetweets: false,
};

type Panel = 'github' | 'x' | 'revalidate' | 'translation' | null;

function formFromSummary(data: WorkspaceSummary): WorkspaceForm {
  return {
    ...EMPTY_FORM,
    owner: data.github.owner,
    repo: data.github.repo,
    branch: data.github.branch,
    contentUrl: data.revalidate.contentUrl ?? '',
    tweetsUrl: data.revalidate.tweetsUrl ?? '',
    baseUrl: data.translation?.baseUrl ?? '',
    model: data.translation?.model ?? '',
    xTargetUserId: data.x?.targetUserId ?? '',
    xTargetUsername: data.x?.targetUsername ?? '',
    xSyncMethod: data.x?.syncMethod ?? 'none',
    xIncludeReplies: data.x?.includeReplies ?? true,
    xIncludeRetweets: data.x?.includeRetweets ?? false,
  };
}

export default function WorkspacePageClient({ csrfToken, email }: Props) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [form, setForm] = useState<WorkspaceForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminRequest<WorkspaceSummary>('/api/admin/workspace');
      setSummary(data);
      setForm(formFromSummary(data));
      setError(null);
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('workspace.accountLoadError'));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function update<K extends keyof WorkspaceForm>(key: K, value: WorkspaceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(input: WorkspaceUpdateInput, message: string) {
    setSaving(true);
    try {
      const data = await adminRequest<WorkspaceSummary>('/api/admin/workspace', {
        method: 'PUT',
        csrfToken,
        body: input,
      });
      setSummary(data);
      setForm(formFromSummary(data));
      setPanel(null);
      toast.success(message);
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(caught instanceof Error ? caught.message : t('workspace.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function verifyRepository() {
    setVerifying(true);
    setVerification(null);
    try {
      const data = await adminRequest<WorkspaceVerifyData>('/api/admin/workspace/verify', {
        method: 'POST',
      });
      setVerification(
        t('workspace.verified', { owner: data.repository.owner, repo: data.repository.repo }),
      );
      toast.success(t('workspace.verifiedSuccess'));
    } catch (caught) {
      if (isAdminApiError(caught) && caught.status === 401) {
        router.push('/login');
        return;
      }
      toast.error(caught instanceof Error ? caught.message : t('workspace.verifyError'));
    } finally {
      setVerifying(false);
    }
  }

  if (loading)
    return (
      <PageFrame size="default">
        <PageHeader title={t('workspace.title')} description={t('workspace.loading')} />
        <div className="rounded-2xl border bg-card p-8">
          <div
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="animate-spin motion-reduce:animate-none" />
            {t('common.loading')}
          </div>
        </div>
      </PageFrame>
    );
  if (error || !summary)
    return (
      <PageFrame size="default">
        <PageHeader title={t('workspace.title')} description={t('workspace.privateHint')} />
        <EmptyState
          title={t('workspace.unavailable')}
          description={error ?? t('common.tryLater')}
          action={
            <Button type="button" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          }
        />
      </PageFrame>
    );

  const xConfigured = Boolean(summary.x);
  const xLabel =
    summary.x?.syncMethod === 'api'
      ? `@${summary.x.targetUsername || t('workspace.unnamedAccount')} · ${t('workspace.xApiShort')}`
      : summary.x
        ? `@${summary.x.targetUsername || t('workspace.unnamedAccount')} · ${t('workspace.xNone')}`
        : t('workspace.xNotConfigured');
  const revalidateCount = [
    summary.revalidate.hasContentUrl,
    summary.revalidate.hasTweetsUrl,
    summary.revalidate.hasSecret,
  ].filter(Boolean).length;
  const translationLabel = summary.translation
    ? `${summary.translation.model || t('workspace.defaultModel')} · ${summary.translation.baseUrl}`
    : t('workspace.translationNotConfigured');

  return (
    <PageFrame size="default">
      <PageHeader
        title={t('workspace.title')}
        description={
          <>
            {t('workspace.description')}
            <br className="hidden sm:block" />
            {t('workspace.account', { email })}
          </>
        }
      />

      <SettingsSection
        title={t('workspace.statusTitle')}
        description={t('workspace.statusDescription')}
      >
        <SettingsSummaryRow
          label={t('workspace.repository')}
          value={
            summary.github.owner && summary.github.repo
              ? `${summary.github.owner}/${summary.github.repo} · ${summary.github.branch}`
              : t('workspace.notConnected')
          }
          icon={<CodeXml className="size-5" />}
          status={
            <ConfiguredBadge
              configured={
                summary.github.hasToken && Boolean(summary.github.owner && summary.github.repo)
              }
            />
          }
          description={t('workspace.repositoryDescription')}
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={() => setPanel('github')}
            >
              {t('common.manage')}
            </Button>
          }
        />
        <SettingsSummaryRow
          label={t('workspace.x')}
          value={xLabel}
          icon={<MessageCircle className="size-5" />}
          status={<ConfiguredBadge configured={xConfigured} />}
          description={
            summary.x?.lastSyncAt
              ? t('workspace.xLastSync', {
                  date: new Date(summary.x.lastSyncAt).toLocaleString(locale),
                })
              : t('workspace.xDescription')
          }
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={() => setPanel('x')}
            >
              {t('common.manage')}
            </Button>
          }
        />
        <SettingsSummaryRow
          label={t('workspace.revalidate')}
          value={t('workspace.revalidateCount', { count: revalidateCount })}
          icon={<Link2 className="size-5" />}
          status={<ConfiguredBadge configured={revalidateCount > 0} />}
          description={t('workspace.revalidateDescription')}
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={() => setPanel('revalidate')}
            >
              {t('common.manage')}
            </Button>
          }
        />
        <SettingsSummaryRow
          label={t('workspace.translation')}
          value={translationLabel}
          icon={<Languages className="size-5" />}
          status={
            <ConfiguredBadge
              configured={Boolean(summary.translation?.hasApiKey && summary.translation.baseUrl)}
            />
          }
          description={t('workspace.translationDescription')}
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={() => setPanel('translation')}
            >
              {t('common.manage')}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection
        title={t('workspace.connectionCheck')}
        description={t('workspace.connectionDescription')}
        action={
          <AsyncAction
            type="button"
            variant="outline"
            className="min-h-10"
            busy={verifying}
            busyLabel={t('common.verifying')}
            onClick={() => void verifyRepository()}
          >
            <CheckCircle2 />
            {t('workspace.verifyRepository')}
          </AsyncAction>
        }
      >
        <div
          className="flex min-h-16 items-center gap-3 py-4 text-sm"
          role="status"
          aria-live="polite"
        >
          {verification ? (
            <>
              <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              <span>{verification}</span>
            </>
          ) : (
            <>
              <GitBranch className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">{t('workspace.verifyHint')}</span>
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('workspace.accountSecurity')}
        description={t('workspace.accountSecurityDescription')}
      >
        <SettingsSummaryRow
          label={t('workspace.accountLabel')}
          value={email}
          icon={<ShieldCheck className="size-5" />}
          description={t('workspace.securityHint')}
          action={
            <Button
              nativeButton={false}
              type="button"
              variant="outline"
              className="min-h-10"
              render={<a href="/security" />}
            >
              {t('workspace.viewSecurity')}
            </Button>
          }
        />
      </SettingsSection>

      <DetailSheet
        open={panel === 'github'}
        onOpenChange={(open) => setPanel(open ? 'github' : null)}
        title={t('workspace.repositoryManage')}
        description={t('workspace.repositoryDialog')}
        footer={
          <AsyncAction
            className="min-h-11"
            busy={saving}
            busyLabel={t('common.saving')}
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
                t('workspace.repositorySaved'),
              )
            }
          >
            {t('workspace.saveRepository')}
          </AsyncAction>
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-owner">{t('workspace.githubOwner')}</FieldLabel>
            <Input
              id="workspace-owner"
              value={form.owner}
              onChange={(event) => update('owner', event.target.value)}
              placeholder={t('workspace.usernameOrOrg')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-repo">{t('workspace.repositoryName')}</FieldLabel>
            <Input
              id="workspace-repo"
              value={form.repo}
              onChange={(event) => update('repo', event.target.value)}
              placeholder={t('workspace.repositoryNameHint')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-branch">{t('workspace.branch')}</FieldLabel>
            <Input
              id="workspace-branch"
              value={form.branch}
              onChange={(event) => update('branch', event.target.value)}
              placeholder="main"
            />
          </Field>
          <SecretField
            key={`github-token-${summary.github.hasToken}`}
            label={t('workspace.githubToken')}
            configured={summary.github.hasToken}
            value={form.token}
            onChange={(value) => update('token', value)}
            description={t('workspace.githubTokenHint')}
          />
        </FieldGroup>
      </DetailSheet>

      <DetailSheet
        open={panel === 'x'}
        onOpenChange={(open) => setPanel(open ? 'x' : null)}
        title={t('workspace.x')}
        description={t('workspace.xDialog')}
        footer={
          <AsyncAction
            className="min-h-11"
            busy={saving}
            busyLabel={t('common.saving')}
            onClick={() =>
              void save(
                {
                  x: {
                    syncMethod: form.xSyncMethod,
                    targetUserId: form.xTargetUserId,
                    targetUsername: form.xTargetUsername,
                    bearerToken: form.xBearerToken || undefined,
                    includeReplies: form.xIncludeReplies,
                    includeRetweets: form.xIncludeRetweets,
                  },
                },
                t('workspace.xSaved'),
              )
            }
          >
            {t('workspace.xSave')}
          </AsyncAction>
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-x-user-id">{t('workspace.xUserId')}</FieldLabel>
            <Input
              id="workspace-x-user-id"
              value={form.xTargetUserId}
              onChange={(event) => update('xTargetUserId', event.target.value)}
              placeholder="2244994945"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-x-username">{t('workspace.xUsername')}</FieldLabel>
            <Input
              id="workspace-x-username"
              value={form.xTargetUsername}
              onChange={(event) => update('xTargetUsername', event.target.value)}
              placeholder="Arsvine"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-x-method">{t('workspace.xMethod')}</FieldLabel>
            <Select
              value={form.xSyncMethod}
              onValueChange={(value) =>
                update('xSyncMethod', (value ?? 'none') as WorkspaceForm['xSyncMethod'])
              }
            >
              <SelectTrigger id="workspace-x-method">
                <SelectValue>
                  {(value) => (value === 'api' ? t('workspace.xApi') : t('workspace.xNone'))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('workspace.xNone')}</SelectItem>
                <SelectItem value="api">{t('workspace.xApi')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.xSyncMethod === 'api' ? (
            <>
              <SecretField
                key={`x-token-${summary.x?.hasBearerToken ?? false}`}
                label={t('workspace.xBearer')}
                configured={summary.x?.hasBearerToken ?? false}
                value={form.xBearerToken}
                onChange={(value) => update('xBearerToken', value)}
                description={t('workspace.xBearerHint')}
              />
              <div className="grid gap-3">
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3">
                  <label htmlFor="workspace-x-replies" className="text-sm">
                    {t('workspace.xReplies')}
                  </label>
                  <Switch
                    id="workspace-x-replies"
                    checked={form.xIncludeReplies}
                    onCheckedChange={(value) => update('xIncludeReplies', value)}
                  />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3">
                  <label htmlFor="workspace-x-retweets" className="text-sm">
                    {t('workspace.xRetweets')}
                  </label>
                  <Switch
                    id="workspace-x-retweets"
                    checked={form.xIncludeRetweets}
                    onCheckedChange={(value) => update('xIncludeRetweets', value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <FieldDescription>{t('workspace.xNoTokenHint')}</FieldDescription>
          )}
        </FieldGroup>
      </DetailSheet>

      <DetailSheet
        open={panel === 'revalidate'}
        onOpenChange={(open) => setPanel(open ? 'revalidate' : null)}
        title={t('workspace.revalidate')}
        description={t('workspace.revalidateDialog')}
        footer={
          <AsyncAction
            className="min-h-11"
            busy={saving}
            busyLabel={t('common.saving')}
            onClick={() =>
              void save(
                {
                  revalidate: {
                    contentUrl: form.contentUrl || undefined,
                    tweetsUrl: form.tweetsUrl || undefined,
                    secret: form.secret || undefined,
                  },
                },
                t('workspace.revalidateSaved'),
              )
            }
          >
            {t('workspace.saveRevalidate')}
          </AsyncAction>
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-blog-revalidate">
              {t('workspace.blogRevalidate')}
            </FieldLabel>
            <Input
              id="workspace-blog-revalidate"
              type="url"
              value={form.contentUrl}
              onChange={(event) => update('contentUrl', event.target.value)}
              placeholder="https://…/api/revalidate"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-tweets-revalidate">
              {t('workspace.tweetsRevalidate')}
            </FieldLabel>
            <Input
              id="workspace-tweets-revalidate"
              type="url"
              value={form.tweetsUrl}
              onChange={(event) => update('tweetsUrl', event.target.value)}
              placeholder="https://…/api/revalidate/tweets"
            />
          </Field>
          <SecretField
            key={`revalidate-secret-${summary.revalidate.hasSecret}`}
            label={t('workspace.revalidateSecret')}
            configured={summary.revalidate.hasSecret}
            value={form.secret}
            onChange={(value) => update('secret', value)}
            description={t('workspace.revalidateSecretHint')}
          />
        </FieldGroup>
      </DetailSheet>

      <DetailSheet
        open={panel === 'translation'}
        onOpenChange={(open) => setPanel(open ? 'translation' : null)}
        title={t('workspace.translation')}
        description={t('workspace.translationDialog')}
        footer={
          <AsyncAction
            className="min-h-11"
            busy={saving}
            busyLabel={t('common.saving')}
            onClick={() =>
              void save(
                {
                  translation: {
                    baseUrl: form.baseUrl,
                    apiKey: form.apiKey || undefined,
                    model: form.model || undefined,
                  },
                },
                t('workspace.translationSaved'),
              )
            }
          >
            {t('workspace.saveTranslation')}
          </AsyncAction>
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-translation-url">{t('workspace.baseUrl')}</FieldLabel>
            <Input
              id="workspace-translation-url"
              type="url"
              value={form.baseUrl}
              onChange={(event) => update('baseUrl', event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-translation-model">{t('workspace.model')}</FieldLabel>
            <Input
              id="workspace-translation-model"
              value={form.model}
              onChange={(event) => update('model', event.target.value)}
              placeholder={t('workspace.optional')}
            />
          </Field>
          <SecretField
            key={`translation-key-${summary.translation?.hasApiKey ?? false}`}
            label={t('workspace.apiKey')}
            configured={summary.translation?.hasApiKey ?? false}
            value={form.apiKey}
            onChange={(value) => update('apiKey', value)}
            description={t('workspace.apiKeyHint')}
          />
        </FieldGroup>
      </DetailSheet>
    </PageFrame>
  );
}
