import { redirect } from 'next/navigation';
import AdminShell from '../../components/admin/admin-shell';
import WorkspacePageClient from '../../components/workspace/workspace-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function WorkspacePage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/login');
  return (
    <AdminShell
      csrfToken={session.csrf}
      email={session.email}
      role={session.role}
      developmentBypass={Boolean(session.developmentBypass)}
    >
      <WorkspacePageClient csrfToken={session.csrf} email={session.email} />
    </AdminShell>
  );
}
