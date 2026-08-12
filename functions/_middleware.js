import { isEmptyBinding, jsonResponse } from './utils/http.js';
import { basicAuthentication } from './utils/auth.js';
import { ownerPasswordSet, isOwnerLoggedIn } from './utils/owner-auth.js';

// 根中间件：把整站置于所有者登录态之后（公开白名单除外），实现「仅我可用」。
//
// 通过条件（任一）：
//   1. 命中公开白名单
//   2. 有效 wb_owner 签名 Cookie（Web 登录态）
//   3. 有效 HTTP Basic（BASIC_USER/BASIC_PASS，兼容 API 脚本）
//   4. POST /upload 携带有效 UPLOAD_BASIC_USER/UPLOAD_BASIC_PASS
// 否则：页面请求 → 302 /auth?next=...；API 请求 → 401 JSON。

// 公开白名单：不要求登录。
function isPublicPath(path) {
  if (path === '/auth' || path === '/auth/') return true;
  if (path === '/block-img.html' || path === '/whitelist-on.html') return true;
  if (path === '/favicon.ico' || path === '/bg.svg' || path === '/music.svg' || path === '/robots.txt') return true;
  if (path.startsWith('/file/')) return true;
  if (path.startsWith('/share')) return true;
  if (path.startsWith('/api/share')) return true;
  if (path.startsWith('/api/auth/')) return true;
  if (path === '/api/config') return true;
  if (path.startsWith('/api/bing/')) return true;
  if (path.startsWith('/assets/')) return true;
  if (path.startsWith('/netdisk')) return true; // 自有 _middleware.js 鉴权
  if (path.startsWith('/webdav')) return true;  // 自带 authenticateWebDAV
  return false;
}

function checkBasic(request, env) {
  if (isEmptyBinding(env.BASIC_USER) || isEmptyBinding(env.BASIC_PASS)) return false;
  if (!request.headers.has('Authorization')) return false;
  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) return false; // 格式错误
  return env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass;
}

function checkUploadBasic(request, env) {
  if (isEmptyBinding(env.UPLOAD_BASIC_USER) || isEmptyBinding(env.UPLOAD_BASIC_PASS)) return false;
  if (!request.headers.has('Authorization')) return false;
  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) return false;
  return env.UPLOAD_BASIC_USER === credentials.user && env.UPLOAD_BASIC_PASS === credentials.pass;
}

async function gate(context) {
  const { request, env } = context;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return context.next();
  }
  const path = url.pathname;

  if (isPublicPath(path)) return context.next();

  // 鉴权未配置 → 公开模式（向后兼容）
  if (!ownerPasswordSet(env)) return context.next();

  try {
    if (await isOwnerLoggedIn(request, env)) return context.next();
    if (checkBasic(request, env)) return context.next();
    if (path === '/upload' && checkUploadBasic(request, env)) return context.next();
  } catch {
    // 鉴权检查异常 → 继续走拒绝分支
  }

  const isApi = path.startsWith('/api/') || path === '/upload';
  if (isApi) {
    return jsonResponse(
      { error: 'auth_required', message: '请先登录后再操作。' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const next = encodeURIComponent(path + url.search);
  return Response.redirect(`${url.origin}/auth?next=${next}`, 302);
}

// CORS：允许跨域调用（如独立前端站点向图床上传文件）。
// 单用户私有图床场景，默认允许所有来源；如需收紧，可把 '*' 改为具体来源域名。
const CORS_ALLOW_ORIGIN = '*';

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', CORS_ALLOW_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = [
  async function (context) {
    // 预检请求：放行并返回 CORS 头
    if (context.request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }
    try {
      return withCors(await gate(context));
    } catch (err) {
      return withCors(new Response(err.message + '\n' + (err.stack || ''), { status: 500 }));
    }
  },
];
