import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/theme-provider';
import AdminAnalytics from '@/components/analytics';
import { LocaleProvider } from '@/components/i18n/locale-provider';
import { LOCALE_COOKIE, resolveLocale } from '@/components/i18n/messages';
import './globals.css';

export const metadata: Metadata = {
  title: 'ARSVINE ADMIN',
  description: 'Web-only writing and publishing console for the private content repository.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
        <AdminAnalytics />
      </body>
    </html>
  );
}
