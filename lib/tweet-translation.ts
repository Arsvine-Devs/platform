import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    getTranslationTargetLocales,
    getTweetTranslationPromptKey,
    type SiteTweetLocale,
    type TweetItem,
    type TweetLang,
    type TweetTranslation,
} from './tweets-types';
import { getWorkspace, isDevelopmentWorkspace } from './workspace-context';

const PROMPTS_DIR = path.join(process.cwd(), 'prompts');
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_THINKING = 'enabled';
const DEFAULT_DEEPSEEK_REASONING_EFFORT = 'high';
type DeepSeekThinkingMode = 'enabled' | 'disabled';
type DeepSeekReasoningEffort = 'high' | 'max';

/**
 * 把 `<Explain note="...">phrase</Explain>` 退化为 `phrase`，
 * 让翻译模型只看到纯文本——译文不带注解（设计取舍：注解多与原语
 * 文化/语言学相关，机翻另一语种里复用注解原文反而误导）。
 *
 * 严格匹配双引号 + 非嵌套子集，与主站
 * `lib/tweets/parse-explain.tsx` 同形态。
 */
const EXPLAIN_TAG_RE = /<Explain\s+note="([^"]*)">([\s\S]*?)<\/Explain>/g;

export function stripExplainForTranslation(content: string): string {
    return content.replace(EXPLAIN_TAG_RE, (_match, _note, children: string) => children);
}

function getDateParts(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Invalid date value.');
    }

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second,
    };
}

function toShanghaiIso(value: Date | string) {
    const { year, month, day, hour, minute, second } = getDateParts(value);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

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

async function loadPromptTemplate(targetLocale: SiteTweetLocale) {
    const promptKey = getTweetTranslationPromptKey(targetLocale);
    const filePath = path.join(PROMPTS_DIR, `${promptKey}.md`);
    return fs.readFile(filePath, 'utf8');
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

function parseTranslationPayload(value: string) {
    const cleaned = stripCodeFences(value);
    if (!cleaned) {
        throw new Error('Translation response is empty.');
    }

    return cleaned;
}

async function requestTranslation(params: {
    content: string;
    targetLocale: SiteTweetLocale;
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
            `Translation request failed for ${params.targetLocale}: ${response.status} ${response.statusText}${rawBody ? ` - ${rawBody}` : ''}`,
        );
    }

    const payload = JSON.parse(rawBody) as unknown;
    return {
        content: parseTranslationPayload(extractMessageContent(payload)),
        model,
        promptKey: getTweetTranslationPromptKey(params.targetLocale),
    };
}

export async function buildTweetTranslations(params: {
    content: string;
    sourceLang: TweetLang;
}) {
    const translatedAt = toShanghaiIso(new Date());
    const targets = getTranslationTargetLocales(params.sourceLang);
    // 翻译前剥离 <Explain> 标签——模型只看纯文本，避免它把 JSX
    // 拆开解释或破坏。译文将不含注解。
    const sanitizedContent = stripExplainForTranslation(params.content);
    const translations = await Promise.all(
        targets.map(async (targetLocale) => {
            const result = await requestTranslation({
                content: sanitizedContent,
                targetLocale,
            });

            return [
                targetLocale,
                {
                    content: result.content,
                    sourceLang: params.sourceLang,
                    translatedAt,
                    model: result.model,
                    promptKey: result.promptKey,
                } satisfies TweetTranslation,
            ] as const;
        }),
    );

    return Object.fromEntries(translations) as Partial<Record<SiteTweetLocale, TweetTranslation>>;
}

export function markTweetTranslationsStale(
    translations?: TweetItem['translations'],
) {
    if (!translations) return undefined;

    return Object.fromEntries(
        Object.entries(translations).map(([locale, translation]) => [
            locale,
            translation ? { ...translation, stale: true } : translation,
        ]),
    ) as TweetItem['translations'];
}
