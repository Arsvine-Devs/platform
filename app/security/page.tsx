import { redirect } from 'next/navigation';

import AdminShell from '@/components/admin/admin-shell';
import SecurityPageClient from '@/components/security/security-page-client';
import { getSessionFromCookieStore } from '@/lib/auth';

export default async function SecurityPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/login');
  if (session.role !== 'owner') redirect('/library');

  return (
    <AdminShell csrfToken={session.csrf} email={session.email} role={session.role} developmentBypass={Boolean(session.developmentBypass)}>
      <SecurityPageClient csrfToken={session.csrf} developmentBypass={Boolean(session.developmentBypass)} />
    </AdminShell>
  );
}
