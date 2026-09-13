import { describe, expect, it } from 'vitest';

import { buildPreviewContent, hasUnsupportedMdx, sanitizeUrl } from './blog-preview-utils';

describe('blog preview URL safety', () => {
  it('allows supported absolute and relative links', () => {
    expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(sanitizeUrl('mailto:author@example.com')).toBe('mailto:author@example.com');
    expect(sanitizeUrl('/blog/example')).toBe('/blog/example');
    expect(sanitizeUrl('#section')).toBe('#section');
  });

  it('rejects dangerous and protocol-relative links', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('data:text/html,hello')).toBeUndefined();
    expect(sanitizeUrl('//evil.example/path')).toBeUndefined();
    expect(sanitizeUrl('\\\\evil.example\\path')).toBeUndefined();
    expect(sanitizeUrl('https://example.com/\u0000')).toBeUndefined();
  });
});

describe('blog preview content', () => {
  it('renders known MDX as safe preview text', () => {
    const preview = buildPreviewContent('<Term note="作品集">Portfolio</Term> <Explain note="说明">phrase</Explain> <Spoiler>secret</Spoiler>');
    expect(preview).toContain('Portfolio');
    expect(preview).toContain('phrase[^1]');
    expect(preview).toContain('||secret||');
    expect(preview).toContain('[^1]: 说明');
    expect(hasUnsupportedMdx(preview)).toBe(false);
  });

  it('flags unknown JSX without attempting to execute it', () => {
    expect(hasUnsupportedMdx('<Unknown prop="value">content</Unknown>')).toBe(true);
  });
});
