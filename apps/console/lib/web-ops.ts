import { request } from 'node:http';
import { readEnv } from '@arsvine/env';

export type WebEnvironment = 'production' | 'preview';

type WebTarget = {
  hostname: string;
  activeDeploymentId: string | null;
};

export type WebProject = {
  id: string;
  repository: string;
  runtime: 'node' | 'static';
  productionRef: string;
  production: WebTarget | null;
  preview: WebTarget | null;
};

export type WebBuild = {
  runId: number;
  commit: string;
  branch: string;
  createdAt: string;
  url: string;
  artifact: string;
};

export type WebDeployment = {
  id: string;
  project: string;
  actor: string;
  environment: WebEnvironment;
  runId: number | null;
  commit: string;
  digest: string | null;
  status: 'queued' | 'deploying' | 'ready' | 'failed';
  updatedAt: string;
  error: string | null;
};

export type WebObservation = {
  observedAt: string;
  environments: {
    environment: WebEnvironment;
    ready: boolean;
    service: {
      activeState: string;
      restarts: number | null;
      memoryBytes: number | null;
    } | null;
    ingress: {
      since: string;
      requests: number;
      errors5xx: number;
      p95Milliseconds: number | null;
      entries: {
        at: string;
        status: number;
        durationMs: number;
        bytes: number;
        path: string | null;
        requestId: string | null;
        cfRay: string | null;
      }[];
    } | null;
  }[];
};

type DeploymentRequest = {
  project: string;
  environment: WebEnvironment;
  runId: number;
  commit: string;
  actor: string;
};

export class WebOpsError extends Error {
  constructor(readonly status: number) {
    super('The deployment service could not complete the request.');
  }
}

function socketRequest<T>(path: string, body?: DeploymentRequest): Promise<T> {
  const socketPath = readEnv('WEB_OPS_SOCKET') ?? '/run/arsvine-web/control.sock';
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const operation = request(
      {
        socketPath,
        path,
        method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(8000),
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : undefined,
      },
      (response) => {
        const status = response.statusCode ?? 503;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new WebOpsError(status));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('error', () => reject(new WebOpsError(503)));
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 1024 * 1024) {
            response.destroy(new WebOpsError(502));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch {
            reject(new WebOpsError(502));
          }
        });
      },
    );
    operation.on('error', () => reject(new WebOpsError(503)));
    operation.end(payload);
  });
}

export async function listWebProjects() {
  return (await socketRequest<{ projects: WebProject[] }>('/v1/projects')).projects;
}

export async function listWebBuilds(project: string, environment: WebEnvironment) {
  const query = new URLSearchParams({ project, environment });
  return (await socketRequest<{ builds: WebBuild[] }>(`/v1/builds?${query}`)).builds;
}

export async function listWebDeployments(project?: string, environment?: WebEnvironment) {
  const query = new URLSearchParams();
  if (project) query.set('project', project);
  if (environment) query.set('environment', environment);
  return (await socketRequest<{ deployments: WebDeployment[] }>(`/v1/deployments?${query}`))
    .deployments;
}

export async function observeWebProject(project: string) {
  const query = new URLSearchParams({ project });
  return (await socketRequest<{ observation: WebObservation }>(`/v1/observation?${query}`))
    .observation;
}

export async function requestDeployment(body: DeploymentRequest) {
  return (await socketRequest<{ deployment: WebDeployment }>('/v1/deployments', body)).deployment;
}
