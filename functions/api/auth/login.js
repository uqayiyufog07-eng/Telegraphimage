import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  getUser,
  updateUser,
  verifyPassword,
  createSession,
  sessionCookieHeader,
  publicUser,
  getLoginLock,
  recordLoginFailure,
  clearLoginFailures,
} from '../../utils/users.js';

// 登录：POST /api/auth/login  { username, password }
// 连续失败 5 次锁定 10 分钟（按用户名计）。
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!authAvailable(env)) {
    return jsonResponse({
      error: 'auth_unavailable',
      message: '用户系统未启用：需要绑定名为 img_url 的 KV 命名空间。',
    }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return jsonResponse({ error: 'bad_request', message: '请输入用户名和密码。' }, { status: 400 });
  }

  const lock = await getLoginLock(env, username);
  if (lock.locked) {
    return jsonResponse({
      error: 'login_locked',
      message: '失败次数过多，账号已临时锁定，请 10 分钟后再试。',
    }, { status: 429 });
  }

  const user = await getUser(env, username);

  // 禁用账号：明确告知，且不计入失败次数
  if (user && user.disabled) {
    return jsonResponse({
      error: 'account_disabled',
      message: '该账号已被停用，请联系管理员。',
    }, { status: 403 });
  }

  const ok = user && await verifyPassword(password, user);

  if (!ok) {
    await recordLoginFailure(env, username);
    return jsonResponse({
      error: 'invalid_credentials',
      message: '用户名或密码不正确。',
    }, { status: 401 });
  }

  await clearLoginFailures(env, username);
  user.lastLoginAt = new Date().toISOString();
  await updateUser(env, user);

  const token = await createSession(env, username);

  return jsonResponse({ ok: true, user: publicUser(user) }, {
    headers: { 'Set-Cookie': sessionCookieHeader(request, token) },
  });
}
