import { describe, expect, it } from 'vitest';

import { LOCALES, messages } from './messages';

describe('admin interface locales', () => {
  it('exposes the supported UI locales with a complete shared baseline', () => {
    expect(LOCALES).toEqual(['zh-CN', 'zh-TW', 'en']);
    expect(Object.keys(messages['zh-TW']).sort()).toEqual(Object.keys(messages['zh-CN']).sort());
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages['zh-CN']).sort());
  });

  it('keeps the Traditional Chinese shell and editor labels translated', () => {
    expect(messages['zh-TW']['shell.sidebar']).toBe('切換側欄');
    expect(messages['zh-TW']['library.title']).toBe('內容庫');
    expect(messages['zh-TW']['mdx.toolbar.bulletedList']).toBe('項目符號列表');
  });

  it('provides English labels for the shell and MDX editor', () => {
    expect(messages.en['shell.search']).toBe('Find');
    expect(messages.en['nav.library']).toBe('Library');
    expect(messages.en['mdx.toolbar.source']).toBe('Source mode');
  });
});
