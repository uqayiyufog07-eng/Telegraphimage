import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  getRegistrationMode,
  getSessionUser,
} from '../../utils/users.js';

// 当前登录状态：GET /api/auth/me
// 前端各页面据此渲染导航上的登录/用户入口。
export async function onRequestGet(context) {
  const { request, env } = context;

  const enabled = authAvailable(env);
  const mode = enabled ? await getRegistrationMode(env) : 'closed';
  const session = enabled ? await getSessionUser(request, env) : null;

  return jsonResponse({
    authEnabled: enabled,
    registrationMode: mode,
    registrationOpen: mode !== 'closed',
    inviteRequired: mode === 'invite',
    user: session ? {
      username: session.username,
      createdAt: session.createdAt,
      lastLoginAt: session.lastLoginAt,
      role: session.role,
    } : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
