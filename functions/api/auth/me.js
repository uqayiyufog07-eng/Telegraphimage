import { jsonResponse } from '../../utils/http.js';
import { ownerPasswordSet, isOwnerLoggedIn } from '../../utils/owner-auth.js';

// 当前登录状态：GET /api/auth/me
// 前端各页面据此渲染导航上的登录/所有者入口。
export async function onRequestGet(context) {
  const { request, env } = context;

  const enabled = ownerPasswordSet(env);
  const loggedIn = enabled ? await isOwnerLoggedIn(request, env) : false;

  return jsonResponse({
    authEnabled: enabled,
    loggedIn: loggedIn,
    owner: loggedIn,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
