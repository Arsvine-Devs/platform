import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PageFrameProps = {
  children: ReactNode;
  className?: string;
  size?: 'narrow' | 'default' | 'wide' | 'full';
};

const sizeClasses: Record<NonNullable<PageFrameProps['size']>, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
};

export function PageFrame({ children, className, size = 'default' }: PageFrameProps) {
  return (
    <div
      id="main-content"
      className={cn(
        'mx-auto flex min-h-full w-full flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10',
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  );
}

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
