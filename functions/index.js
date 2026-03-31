// Cloudflare Pages Function: redirect root to blog
export async function onRequest(context) {
    return Response.redirect(new URL('/blog.html', context.request.url), 301);
}
