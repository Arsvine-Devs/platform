import * as React from 'react';
import { useId, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/locale-provider';

type SettingsSectionProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function SettingsSection({
  title,
  description,
  children,
  action,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn('rounded-2xl border bg-card shadow-sm', className)}>
      <div className="flex flex-col gap-3 border-b px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-5 py-1 sm:px-6">{children}</div>
    </section>
  );
}

type SettingsSummaryRowProps = {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function SettingsSummaryRow({
  label,
  value,
  description,
  icon,
  status,
  action,
  className,
}: SettingsSummaryRowProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-4 border-b py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{label}</h3>
            {status}
          </div>
          <p className="mt-1 truncate text-sm text-foreground">{value}</p>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0 self-start sm:self-center">{action}</div> : null}
    </article>
  );
}

export function ConfiguredBadge({ configured }: { configured: boolean }) {
  const { t } = useI18n();
  return configured ? (
    <Badge variant="secondary" className="text-success-foreground dark:text-success">
      {t('common.configured')}
    </Badge>
  ) : (
    <Badge variant="outline">{t('common.notConfigured')}</Badge>
  );
}

type ConfiguredFieldProps = {
  label: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  description?: ReactNode;
  placeholder?: string;
  inputType?: 'text' | 'url' | 'password';
  configuredDisplay?: ReactNode;
  autoComplete?: string;
  disabled?: boolean;
};

export function SecretField({
  label,
  configured,
  value,
  onChange,
  description,
  placeholder,
  inputType = 'password',
  configuredDisplay,
  autoComplete = 'off',
  disabled,
}: ConfiguredFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const [editing, setEditing] = React.useState(!configured);

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {configured && !editing ? <ConfiguredBadge configured /> : null}
      </div>
      {configured && !editing ? (
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 text-sm">
          <span
            className={
              configuredDisplay
                ? 'text-sm text-muted-foreground'
                : 'font-mono tracking-[0.18em] text-muted-foreground'
            }
            aria-label={`${label}${t('common.configured')}`}
          >
            {configuredDisplay ?? '••••••••••••'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => setEditing(true)}
          >
            {t('common.replace')}
          </Button>
        </div>
      ) : (
        <Input
          id={id}
          type={inputType}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? t('workspace.keepExisting')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
