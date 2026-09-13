import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { BlogLocale } from './admin-api/contracts';
import { getWorkspace, isDevelopmentWorkspace } from './workspace-context';

const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_THINKING = 'enabled';
const DEFAULT_DEEPSEEK_REASONING_EFFORT = 'high';
const PROMPTS_DIR = path.join(process.cwd(), 'prompts');

type BlogTranslationTargetLocale = Extract<BlogLocale, 'zh-TW' | 'en'>;
type DeepSeekThinkingMode = 'enabled' | 'disabled';
type DeepSeekReasoningEffort = 'high' | 'max';

export type BlogTranslationResult = {
  locale: BlogTranslationTargetLocale;
  title: string;
  excerpt: string;
  tags: string[];
  content: string;
  originLocale: string;
};

function getTranslationApiConfig() {
  const translation = getWorkspace().translation;
  const baseUrl = translation?.baseUrl.trim();
  const apiKey = translation?.apiKey.trim();
  const model = translation?.model?.trim() || DEFAULT_MODEL;
  const thinking = translation?.thinking?.trim();
  const reasoningEffort = translation?.reasoningEffort?.trim();

  if (!baseUrl) {
    throw new Error('请先配置个人翻译服务。');
  }
  if (!apiKey) {
    throw new Error('请先配置个人翻译服务密钥。');
  }

  if (thinking && thinking !== 'enabled' && thinking !== 'disabled') {
    throw new Error('AI_TRANSLATION_THINKING must be "enabled" or "disabled".');
  }

  return { baseUrl, apiKey, model, thinking, reasoningEffort };
}

function buildChatCompletionsUrl(baseUrl: string) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalizedBase).toString();
}

function isDeepSeekTranslationConfig(config: {
  baseUrl: string;
  model: string;
}) {
  return (
    config.baseUrl.toLowerCase().includes('deepseek') ||
    config.model.toLowerCase().startsWith('deepseek-')
  );
}

function normalizeDeepSeekReasoningEffort(
  value?: string,
): DeepSeekReasoningEffort | undefined {
  if (!value) return undefined;
  if (value === 'high' || value === 'max') return value;
  if (value === 'low' || value === 'medium') return 'high';
  if (value === 'xhigh') return 'max';

  throw new Error(
    'AI_TRANSLATION_REASONING_EFFORT must be one of: low, medium, high, xhigh, max.',
  );
}

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractMessageContent(payload: unknown) {
  const content = (payload as {
    choices?: Array<{ message?: { content?: string } }>;
  })?.choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error('Translation model returned an empty response.');
  }

  return content;
}

function parseStructuredTranslation(value: string) {
  const cleaned = stripCodeFences(value);
  if (!cleaned) {
    throw new Error('Translation response is empty.');
  }

  try {
    const parsed = JSON.parse(cleaned) as {
      title?: string;
      excerpt?: string;
      tags?: string[];
      content?: string;
    };

    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.excerpt !== 'string' ||
      !Array.isArray(parsed.tags) ||
      typeof parsed.content !== 'string'
    ) {
      throw new Error('Invalid translation JSON shape.');
    }

    return {
      title: parsed.title.trim(),
      excerpt: parsed.excerpt.trim(),
      tags: parsed.tags.map((tag) => String(tag).trim()).filter(Boolean),
      content: parsed.content.trim(),
    };
  } catch {
    throw new Error('Translation response is not valid JSON.');
  }
}

async function loadPromptTemplate(targetLocale: BlogTranslationTargetLocale) {
  const fileName =
    targetLocale === 'zh-TW' ? 'translate-blog-to-zh-TW.md' : 'translate-blog-to-en.md';
  const filePath = path.join(PROMPTS_DIR, fileName);
  return fs.readFile(filePath, 'utf8');
}

async function requestTranslation(params: {
  content: string;
  targetLocale: BlogTranslationTargetLocale;
}) {
  if (isDevelopmentWorkspace()) {
    throw new Error('Development preview cannot access translation services.');
  }
  const { baseUrl, apiKey, model, thinking, reasoningEffort } = getTranslationApiConfig();
  const systemPrompt = await loadPromptTemplate(params.targetLocale);
  const useDeepSeekThinking = isDeepSeekTranslationConfig({ baseUrl, model });
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: params.content,
      },
    ],
  };

  if (useDeepSeekThinking) {
    const thinkingMode: DeepSeekThinkingMode =
      thinking === 'disabled' ? 'disabled' : DEFAULT_DEEPSEEK_THINKING;
    requestBody.thinking = { type: thinkingMode };
    if (thinkingMode === 'enabled') {
      requestBody.reasoning_effort =
        normalizeDeepSeekReasoningEffort(reasoningEffort) ||
        DEFAULT_DEEPSEEK_REASONING_EFFORT;
    }
  } else {
    requestBody.temperature = 1.3;
  }

  const response = await fetch(buildChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Blog translation request failed for ${params.targetLocale}: ${response.status} ${response.statusText}${rawBody ? ` - ${rawBody}` : ''}`,
    );
  }

  const payload = JSON.parse(rawBody) as unknown;
  return parseStructuredTranslation(extractMessageContent(payload));
}

export async function buildBlogTranslations(params: {
  title: string;
  excerpt: string;
  tags: string[];
  content: string;
  sourceLocale: Extract<BlogLocale, 'zh-CN'>;
  targetLocales?: BlogTranslationTargetLocale[];
}) {
  if (params.sourceLocale !== 'zh-CN') {
    throw new Error('Blog auto-translation currently requires zh-CN as the source locale.');
  }

  const targets = params.targetLocales?.length ? params.targetLocales : (['zh-TW', 'en'] as const);
  const sourcePayload = JSON.stringify(
    {
      title: params.title,
      excerpt: params.excerpt,
      tags: params.tags,
      content: params.content,
    },
    null,
    2,
  );

  const translations = await Promise.all(
    targets.map(async (locale) => {
      const translated = await requestTranslation({
        targetLocale: locale,
        content: `请把下面这篇 zh-CN 博文翻译成 ${locale}。\n\n${sourcePayload}`,
      });

      return {
        locale,
        ...translated,
        originLocale: locale === 'en' ? 'zh-CN' : '',
      } satisfies BlogTranslationResult;
    }),
  );

  return translations;
}
