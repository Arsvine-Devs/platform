import { getWorkspace, isDevelopmentWorkspace } from './workspace-context';

type GitHubContentResponse = {
  sha: string;
  content?: string;
};

type GitHubTreeResponse = {
  tree: Array<{ path: string; type: string }>;
};

export class GitHubError extends Error {
  status: number;
  body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

function config() {
  const workspace = getWorkspace();
  const { owner, repo, branch, token } = workspace.github;
  if (!owner || !repo || !token) throw new Error('私有仓库配置不完整。');
  return { workspace, owner, repo, branch: branch || 'main', token };
}

function contentUrl(path: string) {
  const { owner, repo, branch } = config();
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
}

function treeUrl() {
  const { owner, repo, branch } = config();
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
}

async function githubFetch(url: string, init?: RequestInit) {
  if (isDevelopmentWorkspace()) {
    throw new Error('Development preview cannot access GitHub.');
  }
  const { token } = config();
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arsvine-admin',
      ...(init?.headers ?? {}),
    },
  });

  return response;
}

export function getContentRepoInfo() {
  const { owner, repo, branch } = config();
  return {
    owner,
    repo,
    branch,
    url: `https://github.com/${owner}/${repo}`,
  };
}

export async function verifyRepositoryConnection() {
  const { owner, repo } = config();
  const response = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!response.ok) {
    throw new GitHubError(
      `Failed to read repository: ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return { owner, repo };
}

export async function getFile(path: string) {
  const response = await githubFetch(contentUrl(path));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubError(
      `Failed to fetch ${path}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const json = (await response.json()) as GitHubContentResponse;
  const content = json.content
    ? Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8')
    : '';

  return {
    sha: json.sha,
    content,
  };
}

export async function putFile(params: {
  path: string;
  content: string;
  message: string;
  sha?: string;
}) {
  const response = await githubFetch(contentUrl(params.path), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: params.message,
      content: Buffer.from(params.content, 'utf8').toString('base64'),
      branch: config().branch,
      sha: params.sha,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubError(
      `Failed to write ${params.path}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
      response.status,
      body,
    );
  }

  return response.json();
}

export async function deleteFile(params: { path: string; message: string; sha: string }) {
  const response = await githubFetch(contentUrl(params.path), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: params.message,
      branch: config().branch,
      sha: params.sha,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubError(
      `Failed to delete ${params.path}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
      response.status,
      body,
    );
  }

  return response.json();
}

async function listTreePaths() {
  const response = await githubFetch(treeUrl());
  if (!response.ok) {
    throw new GitHubError(
      `Failed to read repo tree: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const json = (await response.json()) as GitHubTreeResponse;
  return json.tree;
}

export async function listBlogVariantPaths() {
  return (await listTreePaths())
    .filter((entry) => entry.type === 'blob' && /^blog\/[^/]+\/[^/]+\.mdx$/.test(entry.path))
    .map((entry) => entry.path)
    .sort();
}

export async function listTweetMonthPaths() {
  return (await listTreePaths())
    .filter((entry) => entry.type === 'blob' && /^tweets\/\d{4}-\d{2}\.json$/.test(entry.path))
    .map((entry) => entry.path)
    .sort((a, b) => b.localeCompare(a));
}

export async function triggerPublicRevalidate(slug?: string) {
  if (isDevelopmentWorkspace()) {
    return {
      revalidated: false,
      paths: [],
      error: 'Development preview: remote revalidation skipped.',
    };
  }
  const { contentUrl, secret } = getWorkspace().revalidate;
  if (!contentUrl || !secret) {
    throw new Error('站点刷新配置不完整。');
  }

  const response = await fetch(contentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      secret,
      ...(slug ? { slug } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Public revalidate failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    );
  }

  return response.json() as Promise<{ revalidated: boolean; paths: string[] }>;
}

export async function triggerTweetsRevalidate() {
  if (isDevelopmentWorkspace()) {
    return {
      revalidated: false,
      paths: [],
      error: 'Development preview: remote revalidation skipped.',
    };
  }
  const { tweetsUrl, secret } = getWorkspace().revalidate;
  if (!tweetsUrl) {
    return undefined;
  }
  if (!secret) {
    return {
      revalidated: false,
      paths: [],
      error: 'Missing PUBLIC_REVALIDATE_SECRET',
    };
  }

  try {
    // POST + body so the shared secret never enters access logs the way a
    // GET querystring would.
    const response = await fetch(tweetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        revalidated: false,
        paths: [],
        error: `Tweets revalidate failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      };
    }

    return response.json() as Promise<{ revalidated: boolean; paths: string[] }>;
  } catch (error) {
    return {
      revalidated: false,
      paths: [],
      error: error instanceof Error ? error.message : 'Tweets revalidate failed.',
    };
  }
}
