'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/components/i18n/locale-provider';

const subscribe = () => () => {};
const getServerSnapshot = () => false;
const getClientSnapshot = () => true;

export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const value = !mounted ? 'dark' : theme === 'light' || theme === 'dark' ? theme : 'system';
  const Icon = value === 'dark' ? Moon : value === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="min-h-11 min-w-11"
            aria-label={t('shell.theme')}
          >
            <Icon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => setTheme(next)}>
            <DropdownMenuRadioItem value="system">
              <Monitor />
              {t('theme.system')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun />
              {t('theme.light')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              {t('theme.dark')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
