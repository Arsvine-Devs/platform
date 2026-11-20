export const mediaImageSources = [
  'https://cdn.arsvine.com/media/',
  'https://preview-realm.arsvine.com/media/',
] as const;

const mediaUrls = mediaImageSources.map((source) => new URL(source));
const relativeBase = new URL('https://console.arsvine.com');

export function isPreviewImageSource(value: string): boolean {
  const url = URL.parse(value, relativeBase);
  if (!url || url.username || url.password) return false;
  return (
    (value.startsWith('/') && !value.startsWith('//') && url.origin === relativeBase.origin) ||
    mediaUrls.some(
      (source) => url.origin === source.origin && url.pathname.startsWith(source.pathname),
    )
  );
}
