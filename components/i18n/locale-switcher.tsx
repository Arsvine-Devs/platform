'use client';

import { Languages } from 'lucide-react';
import { useI18n } from './locale-provider';
import { LOCALES } from './messages';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const labels = { 'zh-CN': '简中', 'zh-TW': '繁中', en: 'EN' } as const;

export default function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="min-h-11 min-w-11"
            aria-label={t('common.language')}
          >
            <Languages />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (LOCALES.includes(value as typeof locale)) setLocale(value as typeof locale);
          }}
          aria-label={t('common.language')}
        >
          {LOCALES.map((item) => (
            <DropdownMenuRadioItem key={item} value={item}>
              {labels[item]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
