# Task

Translate the provided `zh-CN` blog MDX content into a natural, restrained, publishable English version.

You must treat `zh-CN` as the single source text and follow the rules below. These rules are rewritten directly from the site's `mdx_translation_guide.md`.

## Translation Intent

This is literary blog translation, not social-media localization and not explanatory rewriting.

## Core Principles

1. `zh-CN` is the source original. Do not rewrite the piece into a smoother, more explanatory, or more inspirational article.
2. Preserve the original pacing: short sentences, pauses, repetitions, silence, restraint, and the unfamiliar quality of its imagery.
3. Do not elevate the tone beyond the source. If the source is quiet, cold, lucid, or restrained, keep it that way.
4. Do not simplify emotional meaning into flat explanations such as `he was sad` when the original conveys emotion through scene, silence, or gesture.

## English-Specific Rules

1. The English should read naturally, but not at the cost of collapsing the source rhythm into long explanatory prose.
2. Titles may be interpretive rather than literal, but must preserve the source text's direction and atmosphere.
3. Keep metaphors whenever possible instead of replacing them with bland English equivalents.
4. If a cultural expression, institution, poetic line, or context-dependent phrase needs help, prefer using MDX explanation components instead of inserting exposition into the paragraph itself.

## MDX / Markdown Rules

1. Preserve Markdown / MDX structure.
2. Preserve paragraph order, blank lines, lists, headings, blockquotes, and emphasis.
3. Preserve existing `<Term note="...">...</Term>` and `<Explain note="...">...</Explain>` components in both position and function.
4. When additional explanation is necessary:
   - use `Term` only for short word-level explanations;
   - use `Explain` for context, institutions, mythology, quotations, and culture-specific meaning;
   - when a note quotes Chinese source wording, wrap that Chinese text in Chinese curly quotes `“”`;
   - ensure MDX attribute quoting stays valid.
5. Do not output frontmatter. Translate only the values of the provided fields.

## Field Rules

You will only receive four fields:

- `title`
- `excerpt`
- `tags`
- `content`

For these fields:

1. `title` should preserve the source text's literary intent rather than forcing literalness.
2. `excerpt` should stay concise and tonally aligned with the body.
3. `tags` should be short and natural. Typical mappings include:
   - `个人 -> Personal`
   - `随笔 -> Essay`
   - `朋友 -> Friend`
   - proper names usually stay unchanged
4. `content` must be translated in full, without dropping paragraphs.

## Output Rules

1. Output exactly one JSON object.
2. Do not wrap the output in a code block.
3. Do not explain your choices.
4. The JSON shape must be exactly:

{"title":"...","excerpt":"...","tags":["..."],"content":"..."}

5. The JSON must be directly parseable with `JSON.parse`.
