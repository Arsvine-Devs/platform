'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps, ComponentType, PropsWithChildren } from 'react';

type NextThemesProviderProps = PropsWithChildren<ComponentProps<typeof NextThemesProvider>>;
const NextThemesProviderWithChildren = NextThemesProvider as ComponentType<NextThemesProviderProps>;

export function ThemeProvider({ children, ...props }: NextThemesProviderProps) {
  return (
    <NextThemesProviderWithChildren
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProviderWithChildren>
  );
}
