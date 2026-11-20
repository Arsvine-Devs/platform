import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminShell from '@/components/admin/admin-shell';
import styles from '@/components/projects/operations.module.css';
import { getSessionFromCookieStore } from '@/lib/auth';
import { listWebDeployments, listWebProjects } from '@/lib/web-ops';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect('/auth/start?returnTo=/projects');
  if (session.role !== 'owner') redirect('/library');

  const [projects, deployments] = await Promise.all([
    listWebProjects().catch(() => null),
    listWebDeployments().catch(() => []),
  ]);

  return (
    <AdminShell csrfToken={session.csrf} email={session.email} role={session.role}>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Projects</h1>
          <a className={styles.actionLink} href="https://status.arsvine.com">
            Public status
          </a>
        </header>
        {!projects && <p role="status">The deployment service is unavailable.</p>}
        {projects?.length === 0 && <p>Register a repository to see its builds and deployments.</p>}
        {projects && (
          <div className={styles.grid}>
            {projects.map((project) => {
              const target = project.production ?? project.preview;
              if (!target) return null;
              const environment = project.production ? 'production' : 'preview';
              const current = deployments.find(({ id }) => id === target.activeDeploymentId);
              const latest = deployments.find(
                ({ project: id, environment: slot }) => id === project.id && slot === environment,
              );
              return (
                <article className={styles.card} key={project.id}>
                  <div className={styles.cardHeading}>
                    <h2>
                      <Link className={styles.actionLink} href={`/projects/${project.id}`}>
                        {project.id}
                      </Link>
                    </h2>
                    <span className={styles.status} data-state={latest?.status}>
                      {latest?.status ?? 'Awaiting deploy'}
                    </span>
                  </div>
                  <a className={styles.subtle} href={`https://${target.hostname}`}>
                    {target.hostname}
                  </a>
                  <div className={styles.mono}>
                    {current
                      ? `${current.commit.slice(0, 8)} · ${project.productionRef}`
                      : project.productionRef}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
