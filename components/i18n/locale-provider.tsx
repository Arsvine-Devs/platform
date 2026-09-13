'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, messages, type AppLocale } from './messages';

type TranslateValues = Record<string, string | number>;
type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, values?: TranslateValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(value: string, values?: TranslateValues) {
  if (!values) return value;
  return value.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: AppLocale;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (nextLocale) => {
        setLocaleState(nextLocale);
        document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
        window.localStorage.setItem(LOCALE_COOKIE, nextLocale);
      },
      t: (key, values) =>
        interpolate(messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key, values),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within LocaleProvider');
  return context;
}
