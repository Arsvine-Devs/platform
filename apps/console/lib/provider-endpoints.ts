const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export function getProviderBaseUrl(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }

  return url.toString().replace(/\/$/, '');
}
