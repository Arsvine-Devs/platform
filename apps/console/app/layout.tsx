import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/theme-provider';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { DeveloperTools } from '@/components/projects/developer-tools';
import { LocaleProvider } from '@/components/i18n/locale-provider';
import { LOCALE_COOKIE, resolveLocale } from '@/components/i18n/messages';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arsvine Console',
  description: 'Manage Arsvine sites, deployments, and content.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
        {process.env.NODE_ENV === 'development' && <DeveloperTools />}
      </body>
    </html>
  );
}
