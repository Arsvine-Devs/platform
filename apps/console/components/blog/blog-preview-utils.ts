const SAFE_ABSOLUTE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const KNOWN_MDX_TAG_PATTERN = /<\/?(?:Term|Explain|Spoiler|Lead|Aside|Mark|Ref)(?:\s+[^>]*)?>/g;

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    containsControlCharacter(trimmed) ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\')
  )
    return undefined;
  if (!URI_SCHEME_PATTERN.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return SAFE_ABSOLUTE_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function buildPreviewContent(
  content: string,
  emptyText = '*Start writing to see the site preview here.*',
) {
  if (!content) return emptyText;

  const footnotes: string[] = [];
  let footnoteIndex = 0;
  let transformed = content.replace(
    /<Explain\s+note="([^"]*)">([\s\S]*?)<\/Explain>/g,
    (_match, note: string, children: string) => {
      footnoteIndex += 1;
      footnotes.push(`[^${footnoteIndex}]: ${note.trim()}`);
      return `${children.trim()}[^${footnoteIndex}]`;
    },
  );

  transformed = transformed.replace(
    /<(Term|Spoiler|Lead|Aside|Mark|Ref)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/g,
    (_match, tag: string, children: string) =>
      tag === 'Spoiler' ? `||${children.trim()}||` : children.trim(),
  );

  return footnotes.length > 0 ? `${transformed}\n\n${footnotes.join('\n')}` : transformed;
}

export function hasUnsupportedMdx(content: string) {
  const withoutKnown = content.replace(KNOWN_MDX_TAG_PATTERN, '');
  return /<\/?[A-Z][A-Za-z0-9]*(?:\s+[^>]*)?>/.test(withoutKnown);
}
