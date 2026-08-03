import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  registrationOpen,
  validateUsername,
  validatePassword,
  getUser,
  createUser,
  updateUser,
  createSession,
  sessionCookieHeader,
  publicUser,
} from '../../utils/users.js';

// 注册：POST /api/auth/register  { username, password }
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!authAvailable(env)) {
    return jsonResponse({
      error: 'auth_unavailable',
      message: '用户系统未启用：需要绑定名为 img_url 的 KV 命名空间。',
    }, { status: 503 });
  }

  if (!registrationOpen(env)) {
    return jsonResponse({
      error: 'registration_closed',
      message: '本站暂未开放注册，请联系站长开通账号。',
    }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const usernameError = validateUsername(username);
  if (usernameError) {
    return jsonResponse({ error: 'invalid_username', field: 'username', message: usernameError }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return jsonResponse({ error: 'invalid_password', field: 'password', message: passwordError }, { status: 400 });
  }

  const existing = await getUser(env, username);
  if (existing) {
    return jsonResponse({
      error: 'username_taken',
      message: '该用户名已被注册，换一个试试。',
    }, { status: 409 });
  }

  const record = await createUser(env, username, password);
  record.lastLoginAt = new Date().toISOString();
  await updateUser(env, record);
  const token = await createSession(env, username);

  return jsonResponse({ ok: true, user: publicUser(record) }, {
    headers: { 'Set-Cookie': sessionCookieHeader(request, token) },
  });
}
