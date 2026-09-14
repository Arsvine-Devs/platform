import { redirect } from 'next/navigation';
import AdminShell from '../../components/admin/admin-shell';
import MembersPageClient from '../../components/members/members-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function MembersPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/login');
  if (session.role !== 'owner') redirect('/library');
  return (
    <AdminShell
      csrfToken={session.csrf}
      email={session.email}
      role={session.role}
      developmentBypass={Boolean(session.developmentBypass)}
    >
      <MembersPageClient csrfToken={session.csrf} />
    </AdminShell>
  );
}
