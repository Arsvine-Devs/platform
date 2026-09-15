import { redirect } from 'next/navigation';

import AdminShell from '../../components/admin/admin-shell';
import TweetsPageClient from '../../components/tweets/tweets-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function TweetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; id?: string }>;
}) {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect('/login');
  }

  return (
    <AdminShell csrfToken={session.csrf} email={session.email} role={session.role}>
      <TweetsPageClient csrfToken={session.csrf} initialSelection={await searchParams} />
    </AdminShell>
  );
}
