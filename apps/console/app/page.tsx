import { redirect } from 'next/navigation';
import { getSessionFromCookieStore } from '@/lib/auth';

export default async function HomePage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/auth/start?returnTo=/');
  redirect(session.role === 'owner' ? '/projects' : '/library');
}
