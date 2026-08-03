import { jsonResponse } from '../../utils/http.js';
import { destroySession, clearSessionCookieHeader } from '../../utils/users.js';

// 退出登录：POST /api/auth/logout
export async function onRequestPost(context) {
  const { request, env } = context;
  await destroySession(request, env);

  return jsonResponse({ ok: true }, {
    headers: { 'Set-Cookie': clearSessionCookieHeader(request) },
  });
}
