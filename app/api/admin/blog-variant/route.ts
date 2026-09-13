import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getBlogVariant } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import { privateJson } from '../../../../lib/private-response';
import type { BlogVariantData } from '../../../../lib/admin-api/contracts';
import { getDevelopmentBlogVariant, isDevelopmentBypassSession } from '../../../../lib/development-preview';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug') || '';
  const locale = searchParams.get('locale') || '';

  if (!slug || !locale) {
    return NextResponse.json(
      { ok: false, error: { message: 'Missing slug or locale.' } },
      { status: 400 },
    );
  }

  if (isDevelopmentBypassSession(session)) {
    const data = getDevelopmentBlogVariant(slug, locale);
    if (!data) return NextResponse.json({ ok: false, error: { message: 'Variant not found.' } }, { status: 404 });
    return privateJson({ ok: true, data });
  }

  try {
    const data: BlogVariantData | null = await withSessionWorkspace(session, () => getBlogVariant(slug, locale));
    if (!data) {
      return NextResponse.json(
        { ok: false, error: { message: 'Variant not found.' } },
        { status: 404 },
      );
    }

    return privateJson({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : 'Failed to load blog variant.' },
      },
      { status: 500 },
    );
  }
}
