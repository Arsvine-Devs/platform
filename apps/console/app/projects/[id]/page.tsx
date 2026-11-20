import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AdminShell from '@/components/admin/admin-shell';
import { DeployRelease } from '@/components/projects/deploy-release';
import styles from '@/components/projects/operations.module.css';
import { getSessionFromCookieStore } from '@/lib/auth';
import {
  listWebBuilds,
  listWebDeployments,
  listWebProjects,
  observeWebProject,
  type WebEnvironment,
} from '@/lib/web-ops';

export const dynamic = 'force-dynamic';

const formatTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatTime.format(date);
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ environment?: string }>;
}) {
  const { id } = await params;
  const session = await getSessionFromCookieStore();
  if (!session) redirect(`/auth/start?returnTo=${encodeURIComponent(`/projects/${id}`)}`);
  if (session.role !== 'owner') redirect('/library');

  const projects = await listWebProjects().catch(() => null);
  const project = projects?.find((entry) => entry.id === id);
  if (!project && projects) notFound();
  if (!project) {
    return (
      <AdminShell csrfToken={session.csrf} email={session.email} role={session.role}>
        <div className={styles.page}>
          <Link href="/projects">Projects</Link>
          <p role="status">The deployment service is unavailable.</p>
        </div>
      </AdminShell>
    );
  }

  const requested = (await searchParams).environment;
  const readOnly = !project.production;
  const environment: WebEnvironment =
    readOnly || (requested === 'preview' && project.preview) ? 'preview' : 'production';
  const target = environment === 'preview' ? project.preview : project.production;
  if (!target) notFound();
  const [builds, deployments, observation] = await Promise.all([
    readOnly ? Promise.resolve(null) : listWebBuilds(id, environment).catch(() => null),
    listWebDeployments(id, environment).catch(() => null),
    observeWebProject(id).catch(() => null),
  ]);
  const runtime = observation?.environments.find((entry) => entry.environment === environment);
  const running =
    deployments?.some(({ status }) => status === 'queued' || status === 'deploying') ?? false;
  const current = deployments?.find(({ id }) => id === target.activeDeploymentId);
  const productionPath = `/projects/${project.id}`;

  return (
    <AdminShell csrfToken={session.csrf} email={session.email} role={session.role}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <Link className={styles.actionLink} href="/projects">
              Projects
            </Link>
            <h1 className={styles.title}>{project.id}</h1>
            <a className={styles.subtle} href={`https://github.com/${project.repository}`}>
              {project.repository}
            </a>
          </div>
          <a className={styles.actionLink} href={`https://${target.hostname}`}>
            Visit {target.hostname}
          </a>
        </header>

        <nav className={styles.nav} aria-label="Environment">
          {project.production && (
            <Link
              href={productionPath}
              aria-current={environment === 'production' ? 'page' : undefined}
            >
              Production
            </Link>
          )}
          {project.preview && (
            <Link
              href={`${productionPath}?environment=preview`}
              aria-current={environment === 'preview' ? 'page' : undefined}
            >
              Preview
            </Link>
          )}
        </nav>

        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.subtle}>Live release</span>
            <strong className={styles.mono}>{current?.commit.slice(0, 12) ?? '—'}</strong>
          </div>
          <div className={styles.card}>
            <span className={styles.subtle}>Origin</span>
            <strong>
              {runtime ? (runtime.ready ? 'Ready' : 'Unavailable') : 'No health data'}
            </strong>
          </div>
          <div className={styles.card}>
            <span className={styles.subtle}>Requests · last hour</span>
            <strong>{runtime?.ingress?.requests ?? '—'}</strong>
          </div>
          <div className={styles.card}>
            <span className={styles.subtle}>Origin latency · p95</span>
            <strong>
              {runtime?.ingress?.p95Milliseconds == null
                ? '—'
                : `${runtime.ingress.p95Milliseconds} ms`}
            </strong>
          </div>
          <div className={styles.card}>
            <span className={styles.subtle}>5xx · last hour</span>
            <strong>{runtime?.ingress?.errors5xx ?? '—'}</strong>
          </div>
        </div>

        <section className={styles.section} aria-labelledby="deploy-heading">
          <h2 id="deploy-heading">Deployments</h2>
          {builds ? (
            <DeployRelease
              key={environment}
              project={project.id}
              environment={environment}
              hostname={target.hostname}
              builds={builds}
              repository={project.repository}
              liveCommit={current?.commit}
              csrf={session.csrf}
              running={running}
            />
          ) : !readOnly ? (
            <p role="status">Builds are temporarily unavailable.</p>
          ) : null}
          {deployments?.length ? (
            <div
              className={styles.tableRegion}
              role="region"
              aria-label="Deployment history"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Commit</th>
                    <th scope="col">Updated · UTC</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((deployment) => (
                    <tr key={deployment.id}>
                      <td>
                        <span className={styles.status} data-state={deployment.status}>
                          {deployment.status}
                        </span>
                      </td>
                      <td>{deployment.commit.slice(0, 8)}</td>
                      <td>
                        <time dateTime={deployment.updatedAt}>
                          {displayTime(deployment.updatedAt)}
                        </time>
                      </td>
                      <td>
                        {deployment.runId === null ? (
                          <span>Local release</span>
                        ) : (
                          <a
                            href={`https://github.com/${project.repository}/actions/runs/${deployment.runId}`}
                          >
                            Build #{deployment.runId}
                          </a>
                        )}
                        {deployment.error && <p className={styles.subtle}>{deployment.error}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.subtle}>
              {deployments ? 'No deployments yet.' : 'Deployment history is unavailable.'}
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="logs-heading">
          <h2 id="logs-heading">Request logs</h2>
          {runtime?.ingress?.entries.length ? (
            <div
              className={styles.tableRegion}
              role="region"
              aria-label="Recent origin requests"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Time · UTC</th>
                    <th scope="col">Path</th>
                    <th scope="col">Status</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Request</th>
                  </tr>
                </thead>
                <tbody>
                  {runtime.ingress.entries.map((entry) => (
                    <tr key={`${entry.at}-${entry.requestId ?? entry.cfRay}-${entry.path}`}>
                      <td>
                        <time dateTime={entry.at}>{displayTime(entry.at)}</time>
                      </td>
                      <td>{entry.path ?? '—'}</td>
                      <td>{entry.status}</td>
                      <td>{entry.durationMs} ms</td>
                      <td className={styles.mono}>{entry.cfRay ?? entry.requestId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.subtle}>
              {runtime?.ingress
                ? 'No origin requests in this window.'
                : 'Request logs are unavailable.'}
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="config-heading">
          <h2 id="config-heading">Access &amp; configuration</h2>
          <dl className={styles.grid}>
            <div className={styles.card}>
              <dt>Domain</dt>
              <dd>{target.hostname}</dd>
            </div>
            <div className={styles.card}>
              <dt>Runtime</dt>
              <dd>{project.runtime}</dd>
            </div>
            <div className={styles.card}>
              <dt>Production branch</dt>
              <dd className={styles.mono}>{project.productionRef}</dd>
            </div>
            {runtime?.service && (
              <div className={styles.card}>
                <dt>Process</dt>
                <dd>
                  {runtime.service.activeState} · {runtime.service.restarts ?? '—'} restarts
                </dd>
                {runtime.service.memoryBytes !== null && (
                  <dd>{Math.round(runtime.service.memoryBytes / 1048576)} MiB memory</dd>
                )}
              </div>
            )}
          </dl>
          <Link className={styles.actionLink} href="/library">
            Manage published content
          </Link>
        </section>
      </div>
    </AdminShell>
  );
}
