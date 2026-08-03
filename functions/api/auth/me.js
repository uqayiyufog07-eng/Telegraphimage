import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  getRegistrationMode,
  getSessionUser,
  ensureLegacyAdmin,
} from '../../utils/users.js';

// 当前登录状态：GET /api/auth/me
// 前端各页面据此渲染导航上的登录/用户入口。
export async function onRequestGet(context) {
  const { request, env } = context;

  const enabled = authAvailable(env);
  const mode = enabled ? await getRegistrationMode(env) : 'closed';
  let session = enabled ? await getSessionUser(request, env) : null;

  // 迁移：旧账号可能无 role 字段，若为首个用户则提升为 admin
  if (session && session.role !== 'admin') {
    const migrated = await ensureLegacyAdmin(env, session.username);
    if (migrated) {
      session = { ...session, role: 'admin' };
    }
  }

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
