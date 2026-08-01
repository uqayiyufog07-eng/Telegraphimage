// /share/{token} 路由：返回 share.html（静态资源）。
// Pages Functions 中静态资源优先级低于 Functions，但 /share/xxx 会匹配到
// 此 catch-all 路由；我们直接把请求转发给静态资源处理器（env.ASSETS），
// 如果不可用则手动返回 share.html。
export async function onRequest(context) {
  const { env, request } = context;

  // 优先用 ASSETS 绑定（Pages 内置静态资源服务）
  if (env.ASSETS) {
    return env.ASSETS.fetch(new URL('/share.html', request.url));
  }

  // 回退：返回简单提示
  return new Response('Share page requires static assets serving. Please access /share.html?token=xxx', {
    status: 302,
    headers: { Location: '/share.html' + new URL(request.url).search },
  });
}
