import { basicAuthentication, unauthorizedResponse } from '../utils/auth.js';
import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { ownerPasswordSet, isOwnerLoggedIn } from '../utils/owner-auth.js';

// 网盘鉴权中间件（所有者单用户模式）。
// - /netdisk 页面：无需 img_r2 检查（让前端展示配置提示）
// - /netdisk/api/*：强依赖 img_r2，未绑定返回 503
//
// 通过条件（任一）：
//   1. 鉴权未配置（OWNER_PASSWORD/BASIC_PASS 均空）→ 公开（向后兼容）
//   2. 有效 wb_owner 签名 Cookie（Web 登录态）
//   3. 有效 HTTP Basic（BASIC_USER/BASIC_PASS，兼容 API/WebDAV 客户端）
//   否则：API → 401 JSON；页面 → 302 /auth?next=...
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

  // 鉴权未配置：公开访问（向后兼容）
  if (!ownerPasswordSet(env)) {
    return context.next();
  }

  // 1. 所有者 Cookie
  if (await isOwnerLoggedIn(request, env)) {
    return context.next();
  }

  // 2. Basic 凭证（API 客户端 / WebDAV 场景）
  if (request.headers.has('Authorization')) {
    const credentials = basicAuthentication(request);
    if (credentials instanceof Response) {
      return credentials;
    }
    if (!isEmptyBinding(env.BASIC_USER) && env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass) {
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

  const next = encodeURIComponent(url.pathname + url.search);
  return Response.redirect(`${url.origin}/auth?next=${next}`, 302);
}

export const onRequest = [errorHandling, authentication];
