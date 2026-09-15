'use client';

import Link from 'next/link';
import { FileText, Library, LogOut, MessageCircle, Search } from 'lucide-react';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { adminRequest } from '@/lib/admin-api/client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { ThemeToggle } from '@/components/theme-toggle';
import LocaleSwitcher from '@/components/i18n/locale-switcher';
import { useI18n } from '@/components/i18n/locale-provider';

type NavItem = {
  href: string;
  labelKey: string;
  icon: ReactNode;
};

type AdminShellClientProps = {
  currentPath: string;
  csrfToken: string;
  email: string;
  role: 'owner' | 'editor';
  children: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/library', labelKey: 'nav.library', icon: <Library /> },
  { href: '/blog', labelKey: 'nav.blog', icon: <FileText /> },
  { href: '/tweets', labelKey: 'nav.tweets', icon: <MessageCircle /> },
];

const PAGE_LABELS: Array<{ prefix: string; labelKey: string }> = [
  { prefix: '/library', labelKey: 'nav.library' },
  { prefix: '/blog', labelKey: 'nav.blog' },
  { prefix: '/tweets', labelKey: 'nav.tweets' },
];

export default function AdminShellClient({
  currentPath,
  csrfToken,
  email,
  role,
  children,
}: AdminShellClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const handleLogout = () => {
    startTransition(async () => {
      try {
        const result = await adminRequest<{ authLogoutUrl: string | null }>('/api/admin/logout', {
          method: 'POST',
          csrfToken,
        });
        window.location.replace(result.authLogoutUrl ?? '/auth/signed-out');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('shell.logoutError'));
      }
    });
  };

  const pageLabelKey = PAGE_LABELS.find(({ prefix }) => currentPath.startsWith(prefix))?.labelKey;
  const pageLabel = pageLabelKey ? t(pageLabelKey) : t('shell.admin');
  const navItems = NAV_ITEMS.map((item) => ({ ...item, label: t(item.labelKey) }));

  function navigateFromSearch(href: string) {
    setSearchOpen(false);
    router.push(href);
  }

  return (
    <SidebarProvider>
      <Toaster richColors position="top-right" />
      <Sidebar
        collapsible="icon"
        mobileTitle={t('shell.sidebarTitle')}
        mobileDescription={t('shell.sidebarDescription')}
      >
        <SidebarHeader className="gap-3 p-3">
          <Link
            href="/library"
            className="flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
              A
            </span>
            <span className="font-semibold tracking-[0.16em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              ARSVINE
            </span>
            <span className="text-muted-foreground group-data-[collapsible=icon]:hidden">
              ADMIN
            </span>
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full justify-start border-sidebar-border bg-sidebar/60 px-3 text-sidebar-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            onClick={() => setSearchOpen(true)}
            aria-label={t('shell.search')}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Search aria-hidden="true" />
            <span className="group-data-[collapsible=icon]:hidden">{t('shell.search')}</span>
            <kbd className="ml-auto rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              ⌘K
            </kbd>
          </Button>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup className="px-1 py-2">
            <SidebarGroupLabel className="px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground group-data-[collapsible=icon]:hidden">
              {t('shell.content')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const label = t(item.labelKey);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={currentPath.startsWith(item.href)}
                        tooltip={label}
                      >
                        {item.icon}
                        <span className="group-data-[collapsible=icon]:hidden">{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-1">
          <div className="flex min-h-10 items-center gap-2 group-data-[collapsible=icon]:flex-col">
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {email.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="truncate text-xs font-medium text-sidebar-foreground">{email}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {role === 'owner' ? t('shell.role.owner') : t('shell.role.editor')}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleLogout}
              disabled={pending}
              className="min-h-10 min-w-10 shrink-0 group-data-[collapsible=icon]:size-10"
              title={t('shell.logout')}
              aria-label={t('shell.logout')}
            >
              <LogOut />
            </Button>
          </div>
          <div className="mt-1 flex items-center gap-1 sm:hidden">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </SidebarFooter>
        <SidebarRail aria-label={t('shell.sidebar')} title={t('shell.sidebar')} />
      </Sidebar>

      <SidebarInset>
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:ring-2"
        >
          {t('shell.skip')}
        </a>
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
          <SidebarTrigger
            className="-ml-1"
            aria-label={t('shell.sidebar')}
            title={t('shell.sidebar')}
          />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{pageLabel}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">ARSVINE ADMIN</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden items-center gap-1 sm:flex">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </SidebarInset>
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title={t('shell.searchTitle')}
        description={t('shell.searchDescription')}
        className="sm:max-w-lg"
      >
        <Command>
          <CommandInput placeholder={t('shell.searchPlaceholder')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('shell.searchEmpty')}</CommandEmpty>
            <CommandGroup heading={t('shell.content')}>
              {navItems.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => navigateFromSearch(item.href)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  <CommandShortcut>{item.href}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </SidebarProvider>
  );
}
