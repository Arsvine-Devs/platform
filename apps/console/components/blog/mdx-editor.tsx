'use client';

import dynamic from 'next/dynamic';
import type { MdxEditorClientProps } from './mdx-editor-client';
import { useI18n } from '@/components/i18n/locale-provider';

const ClientEditor = dynamic(() => import('./mdx-editor-client'), {
  ssr: false,
  loading: () => <EditorLoading />,
});

function EditorLoading() {
  const { t } = useI18n();
  return (
    <div
      className="min-h-96 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none"
      aria-label={t('blog.editorLoading')}
    />
  );
}

export default function MdxEditor(props: MdxEditorClientProps) {
  return <ClientEditor {...props} />;
}
