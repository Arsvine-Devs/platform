import { redirect } from 'next/navigation';
import AdminShell from '../../components/admin/admin-shell';
import OnboardingPageClient from '../../components/workspace/onboarding-page-client';
import { getSessionFromCookieStore } from '../../lib/auth';

export default async function OnboardingPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/login');
  return <AdminShell csrfToken={session.csrf} email={session.email} role={session.role} developmentBypass={Boolean(session.developmentBypass)}>
    <OnboardingPageClient csrfToken={session.csrf} developmentBypass={Boolean(session.developmentBypass)} />
  </AdminShell>;
}
