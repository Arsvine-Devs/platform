import { redirect } from 'next/navigation';
import { getSessionFromCookieStore } from '@/lib/auth';
import { readControlPlanePrincipal } from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

export default async function ControlPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/auth/start?returnTo=/control');

  let controlPlane: Awaited<ReturnType<typeof readControlPlanePrincipal>> | null = null;
  let controlPlaneError: string | null = null;
  if (
    session.authSource === 'oidc' &&
    'accessToken' in session &&
    typeof session.accessToken === 'string'
  ) {
    try {
      controlPlane = await readControlPlanePrincipal(session.accessToken);
    } catch (error) {
      controlPlaneError = error instanceof Error ? error.message : 'Control API unavailable.';
    }
  }

  return (
    <main
      style={{ fontFamily: 'system-ui', margin: '4rem auto', maxWidth: 720, padding: '0 1.5rem' }}
    >
      <p>ARSVINE CONTROL</p>
      <h1>Control Plane</h1>
      <p>
        Signed in as {session.email} ({session.role}).
      </p>
      <section>
        <h2>Authentication</h2>
        <p>Source: Auth OIDC</p>
      </section>
      <section>
        <h2>API</h2>
        {controlPlane ? (
          <p>
            Connected as {controlPlane.id}; {controlPlane.scopes.length} granted scopes.
          </p>
        ) : (
          <p role="alert">
            {controlPlaneError ?? 'Control API validation is not available for this session.'}
          </p>
        )}
      </section>
    </main>
  );
}
