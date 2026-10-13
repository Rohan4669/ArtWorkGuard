// Cloudflare Pages Function: proxies /api/* to the Railway backend so the browser only ever talks to the
// Pages origin. The auth cookie then becomes first-party, which avoids cross-site cookie blocking.
// Optional: set API_ORIGIN in Pages -> Settings -> Variables (defaults to the Railway URL below).
const DEFAULT_API_ORIGIN = 'https://artworkguard-production.up.railway.app';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const origin = (env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, '');
  const headers = new Headers(request.headers);
  headers.delete('host');
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('X-Forwarded-For', ip);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstream = await fetch(origin + url.pathname + url.search, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });
  return new Response(upstream.body, upstream); // keeps status, headers and Set-Cookie
}
