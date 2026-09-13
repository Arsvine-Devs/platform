import * as React from 'react';
import type { ReactNode } from 'react';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/locale-provider';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {description ? (
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </section>
  );
}

type AsyncActionProps = React.ComponentProps<typeof Button> & {
  busy?: boolean;
  busyLabel?: string;
};

export function AsyncAction({ busy = false, busyLabel, children, ...props }: AsyncActionProps) {
  const { t } = useI18n();
  return (
    <Button {...props} disabled={busy || props.disabled} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {busyLabel ?? t('common.processing')}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
