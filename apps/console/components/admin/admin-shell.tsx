import AdminShellClient from './admin-shell-client';
import type { ReactNode } from 'react';

type AdminShellProps = {
  csrfToken: string;
  email: string;
  role: 'owner' | 'editor';
  children: ReactNode;
};

export default function AdminShell({ csrfToken, email, role, children }: AdminShellProps) {
  return (
    <AdminShellClient csrfToken={csrfToken} email={email} role={role}>
      {children}
    </AdminShellClient>
  );
}
