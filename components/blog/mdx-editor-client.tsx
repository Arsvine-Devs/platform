'use client';

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  codeBlockPlugin,
  codeMirrorPlugin,
  ConditionalContents,
  CreateLink,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  GenericJsxEditor,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  jsxPlugin,
  listsPlugin,
  linkPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  type JsxComponentDescriptor,
} from '@mdxeditor/editor';

import type { ReactNode } from 'react';
import { useI18n } from '@/components/i18n/locale-provider';

const codeBlockLanguages = {
  text: 'Text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  bash: 'Shell',
  markdown: 'Markdown',
};

const jsxComponentDescriptors: JsxComponentDescriptor[] = [
  {
    name: 'Term',
    kind: 'text',
    props: [{ name: 'note', type: 'string', required: true }],
    hasChildren: true,
    Editor: GenericJsxEditor,
  },
  {
    name: 'Explain',
    kind: 'text',
    props: [{ name: 'note', type: 'string', required: true }],
    hasChildren: true,
    Editor: GenericJsxEditor,
  },
  { name: 'Spoiler', kind: 'text', props: [], hasChildren: true, Editor: GenericJsxEditor },
  { name: 'Mark', kind: 'text', props: [], hasChildren: true, Editor: GenericJsxEditor },
  { name: 'Lead', kind: 'flow', props: [], hasChildren: true, Editor: GenericJsxEditor },
  { name: 'Aside', kind: 'flow', props: [], hasChildren: true, Editor: GenericJsxEditor },
  { name: 'Ref', kind: 'flow', props: [], hasChildren: true, Editor: GenericJsxEditor },
];

function EditorToolbar() {
  return (
    <DiffSourceToggleWrapper>
      <ConditionalContents
        options={[
          {
            when: (editor) => editor?.editorType === 'codeblock',
            contents: () => <ChangeCodeMirrorLanguage />,
          },
          {
            fallback: () => (
              <>
                <UndoRedo />
                <BoldItalicUnderlineToggles />
                <BlockTypeSelect />
                <ListsToggle options={['bullet', 'number']} />
                <CreateLink />
                <InsertTable />
                <InsertImage />
                <InsertThematicBreak />
              </>
            ),
          },
        ]}
      />
    </DiffSourceToggleWrapper>
  );
}

export type MdxEditorClientProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  onError?: (message: string) => void;
  placeholder?: ReactNode;
  autoFocus?: boolean;
};

export default function MdxEditorClient({
  markdown,
  onChange,
  onError,
  placeholder = 'Start writing…',
  autoFocus = false,
}: MdxEditorClientProps) {
  const { t } = useI18n();
  const translate = (
    key: string,
    defaultValue: string,
    interpolations?: Record<string, unknown>,
  ) => {
    const translatedKey = `mdx.${key}`;
    const translated = t(
      translatedKey,
      interpolations as Record<string, string | number> | undefined,
    );
    return translated === translatedKey ? defaultValue : translated;
  };

  return (
    <MDXEditor
      markdown={markdown}
      translation={translate}
      className="arsvine-mdx-editor"
      contentEditableClassName="max-w-none text-sm leading-7 outline-none"
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(value) => onChange(value)}
      onError={({ error }) => onError?.(error)}
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        markdownShortcutPlugin(),
        linkPlugin(),
        tablePlugin(),
        imagePlugin({ disableImageResize: true }),
        codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
        codeMirrorPlugin({ codeBlockLanguages }),
        diffSourcePlugin(),
        jsxPlugin({ jsxComponentDescriptors, kindMismatchPolicy: 'source' }),
        toolbarPlugin({ toolbarContents: EditorToolbar }),
      ]}
    />
  );
}
