import { basicAuthentication, basicAuthChallengeResponse, unauthorizedResponse } from '../utils/auth.js';
import { isEmptyBinding } from '../utils/http.js';

// 网盘鉴权中间件：复用 BASIC_USER/BASIC_PASS（与后台 /admin 一致）。
// - /netdisk 页面：无需 img_r2 检查（让前端展示配置提示），但需 BASIC 鉴权（若配置）
// - /netdisk/api/*：强依赖 img_r2，未绑定返回 503
async function errorHandling(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error('netdisk middleware error:', err);
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}

async function authentication(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isApiRoute = url.pathname.startsWith('/netdisk/api');

  // API 路由强依赖 R2
  if (isApiRoute && isEmptyBinding(env.img_r2)) {
    return new Response(
      JSON.stringify({ error: 'Netdisk requires R2 bucket binding (img_r2). Please bind it in Pages settings.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // BASIC 鉴权
  if (isEmptyBinding(env.BASIC_USER)) {
    return context.next();
  }

  if (!request.headers.has('Authorization')) {
    return basicAuthChallengeResponse();
  }

  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) {
    return credentials;
  }

  if (env.BASIC_USER !== credentials.user || env.BASIC_PASS !== credentials.pass) {
    return unauthorizedResponse('Invalid credentials.');
  }

  return context.next();
}

export const onRequest = [errorHandling, authentication];
