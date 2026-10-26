const DEFAULT_API_ORIGIN = 'https://artworkguard-production.up.railway.app';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const origin = (env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, '');

  const headers = new Headers(request.headers);
  headers.delete('host');

  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('X-Forwarded-For', ip);

  // ✅ Fix: duplex is required for streaming bodies (file uploads)
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  const upstream = await fetch(origin + url.pathname + url.search, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    duplex: 'half',           // ← ADD THIS for file upload support
    redirect: 'manual',
  });

  // ✅ Fix: Rewrite Set-Cookie domain so it applies to pages.dev, not railway.app
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });

  return response;
}