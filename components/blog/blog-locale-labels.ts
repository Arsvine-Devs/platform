export { BLOG_LOCALES } from '@/lib/admin-api/contracts';
export type { BlogLocale } from '@/lib/admin-api/contracts';

import type { BlogLocale } from '@/lib/admin-api/contracts';

export const localeLabels: Record<BlogLocale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
  en: 'English',
  ja: '日本語',
  ru: 'Русский',
  fr: 'Français',
};

import type { AppLocale } from '@/components/i18n/messages';

const localizedLocaleLabels: Record<AppLocale, Record<BlogLocale, string>> = {
  'zh-CN': localeLabels,
  'zh-TW': { ...localeLabels, 'zh-CN': '简体中文', 'zh-TW': '繁體中文' },
  en: { 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', en: 'English', ja: 'Japanese', ru: 'Russian', fr: 'French' },
};

export function getLocaleLabel(locale: BlogLocale, appLocale: AppLocale) {
  return localizedLocaleLabels[appLocale][locale];
}
