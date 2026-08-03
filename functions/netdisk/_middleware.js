import { basicAuthentication, basicAuthChallengeResponse, unauthorizedResponse } from '../utils/auth.js';
import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { authAvailable, getSessionUser } from '../utils/users.js';

// 网盘鉴权中间件。
// - /netdisk 页面：无需 img_r2 检查（让前端展示配置提示）
// - /netdisk/api/*：强依赖 img_r2，未绑定返回 503
//
// 访问优先级（当配置了 BASIC_USER/BASIC_PASS 时）：
//   1. 已登录的用户会话（wb_session Cookie）→ 放行，免密使用网盘
//   2. Authorization Basic 凭证匹配        → 放行（兼容 API/WebDAV 客户端）
//   3. 页面请求 → 跳转 /auth 登录页；API 请求 → 401 JSON（前端据此提示登录）
//   未启用用户系统（无 img_url KV）时回退为浏览器 BASIC 弹窗。
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
    return jsonResponse(
      { error: 'r2_unbound', message: '网盘功能未启用：需要绑定名为 img_r2 的 R2 存储桶。' },
      { status: 503 }
    );
  }

  // 未配置访问控制：公开访问
  if (isEmptyBinding(env.BASIC_USER)) {
    return context.next();
  }

  // 1. 用户会话
  if (authAvailable(env)) {
    const session = await getSessionUser(request, env);
    if (session) {
      context.data.user = session;
      return context.next();
    }
  }

  // 2. Basic 凭证（API 客户端 / WebDAV 场景）
  if (request.headers.has('Authorization')) {
    const credentials = basicAuthentication(request);
    if (credentials instanceof Response) {
      return credentials;
    }
    if (env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass) {
      return context.next();
    }
    return unauthorizedResponse('Invalid credentials.');
  }

  // 3. 未认证
  if (isApiRoute) {
    return jsonResponse(
      { error: 'auth_required', message: '登录状态已失效，请重新登录后再操作。' },
      { status: 401 }
    );
  }

  if (authAvailable(env)) {
    const next = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(`${url.origin}/auth?next=${next}`, 302);
  }

  return basicAuthChallengeResponse();
}

export const onRequest = [errorHandling, authentication];
