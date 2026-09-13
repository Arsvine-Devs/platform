import { redirect } from 'next/navigation';

import AdminShell from '../../components/admin/admin-shell';
import BlogPageClient from '../../components/blog/blog-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; locale?: string }>;
}) {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect('/login');
  }

  return (
    <AdminShell csrfToken={session.csrf} email={session.email} role={session.role} developmentBypass={Boolean(session.developmentBypass)}>
      <BlogPageClient
        csrfToken={session.csrf}
        initialSelection={await searchParams}
      />
    </AdminShell>
  );
}
