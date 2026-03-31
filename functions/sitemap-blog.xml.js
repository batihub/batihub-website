// Cloudflare Pages Function: proxy blog sitemap from FastAPI backend
const BACKEND = 'https://beelog-poes.onrender.com';

export async function onRequest(context) {
    try {
        const res = await fetch(`${BACKEND}/sitemap-blog.xml`, {
            cf: { cacheTtl: 86400 },
        });
        const xml = await res.text();
        return new Response(xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400',
            },
        });
    } catch {
        const fallback = await context.env.ASSETS.fetch(
            new Request(new URL('/sitemap-blog.xml', context.request.url))
        );
        return fallback;
    }
}
