// /netdisk 路由：返回网盘主界面 netdisk.html。
export async function onRequest(context) {
  const { env, request } = context;

  if (env.ASSETS) {
    return env.ASSETS.fetch(new URL('/netdisk.html', request.url));
  }

  return new Response('Netdisk page not available.', { status: 404 });
}
