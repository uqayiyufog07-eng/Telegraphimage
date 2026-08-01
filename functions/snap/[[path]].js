// /snap 路由：返回 snap.html（快传页面）
export async function onRequest(context) {
  const { env, request } = context;

  if (env.ASSETS) {
    return env.ASSETS.fetch(new URL('/snap.html', request.url));
  }

  return new Response('Snap page requires static assets serving.', {
    status: 302,
    headers: { Location: '/snap.html' + new URL(request.url).search },
  });
}
