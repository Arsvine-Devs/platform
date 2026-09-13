import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getBlogIndex } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import { privateJson } from '../../../../lib/private-response';
import { getDashboardData } from '../../../../lib/tweets';
import type { LibraryData } from '../../../../lib/admin-api/contracts';
import { getDevelopmentLibraryData, isDevelopmentBypassSession } from '../../../../lib/development-preview';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
  if (isDevelopmentBypassSession(session)) return privateJson({ ok: true, data: getDevelopmentLibraryData() });
  try {
    const data: LibraryData = await withSessionWorkspace(session, async () => {
      const [blog, tweets] = await Promise.all([getBlogIndex(), getDashboardData()]);
      const items = [
        ...blog.posts.map((post) => ({ id: `blog:${post.slug}`, type: 'blog' as const, title: post.variants['zh-CN']?.title || post.variants.en?.title || post.slug, locale: post.availableLocales.join(' · '), status: 'published' as const, updatedAt: post.updatedAt, href: `/blog?slug=${encodeURIComponent(post.slug)}&locale=${encodeURIComponent(post.availableLocales[0] ?? 'zh-CN')}` })),
        ...tweets.months.flatMap((month) => month.tweets.map((tweet) => ({ id: `tweet:${tweet.id}`, type: 'tweet' as const, title: tweet.content.replace(/\s+/g, ' ').slice(0, 90) || tweet.id, locale: tweet.lang || 'other', status: tweet.visibility === 'hidden' ? 'draft' as const : 'published' as const, updatedAt: tweet.updatedAt || tweet.createdAt, href: `/tweets?month=${encodeURIComponent(month.month)}&id=${encodeURIComponent(tweet.id)}` }))),
      ].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
      return { items };
    });
    return privateJson({ ok: true, data });
  } catch (error) { return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法加载内容库。' } }, { status: 500 }); }
}
