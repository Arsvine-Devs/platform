const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function getApiBaseUrl() {
  const value = process.env.API_BASE_URL?.trim();
  if (!value) throw new Error('Missing API_BASE_URL');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('API_BASE_URL must be an absolute URL.');
  }

  if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('API_BASE_URL must use HTTPS outside localhost.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_BASE_URL must identify an origin without a path.');
  }
  return url;
}
