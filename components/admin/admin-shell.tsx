import { headers } from 'next/headers';

import AdminShellClient from './admin-shell-client';
import type { ReactNode } from 'react';

type AdminShellProps = {
  csrfToken: string;
  email: string;
  role: 'owner' | 'editor';
  developmentBypass?: boolean;
  children: ReactNode;
};

export default async function AdminShell({
  csrfToken,
  email,
  role,
  developmentBypass = false,
  children,
}: AdminShellProps) {
  const headerStore = await headers();
  const currentPath = headerStore.get('x-pathname') ?? headerStore.get('x-invoke-path') ?? '/blog';

  return (
    <AdminShellClient
      currentPath={currentPath}
      csrfToken={csrfToken}
      email={email}
      role={role}
      developmentBypass={developmentBypass}
    >
      {children}
    </AdminShellClient>
  );
}
