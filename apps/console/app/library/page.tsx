import { redirect } from 'next/navigation';
import AdminShell from '../../components/admin/admin-shell';
import LibraryPageClient from '../../components/library/library-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function LibraryPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/login');
  return (
    <AdminShell
      csrfToken={session.csrf}
      email={session.email}
      role={session.role}
      developmentBypass={Boolean(session.developmentBypass)}
    >
      <LibraryPageClient />
    </AdminShell>
  );
}
