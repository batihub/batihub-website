// Cloudflare Pages Function: proxy dynamic sitemap from FastAPI backend
// This ensures new users and posts appear in Google's index automatically.
const BACKEND = 'https://beelog-poes.onrender.com';

export async function onRequest(context) {
    try {
        const res = await fetch(`${BACKEND}/sitemap-feed.xml`, {
            cf: { cacheTtl: 3600 },
        });
        const xml = await res.text();
        return new Response(xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch {
        // Backend sleeping (Render free tier spin-up) — serve static fallback
        const fallback = await context.env.ASSETS.fetch(
            new Request(new URL('/sitemap-feed.xml', context.request.url))
        );
        return fallback;
    }
}
