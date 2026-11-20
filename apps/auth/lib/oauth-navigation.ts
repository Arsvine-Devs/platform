export function oauthDestination(
  value: string,
  signedQuery: string,
  authOrigin: string,
): string | null {
  try {
    const target = new URL(value, authOrigin);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      return null;
    }
    if (target.origin === authOrigin) return target.href;
    const registered = new URL(
      new URLSearchParams(signedQuery).get("redirect_uri") ?? "",
    );
    return target.origin === registered.origin &&
      target.pathname === registered.pathname
      ? target.href
      : null;
  } catch {
    return null;
  }
}
