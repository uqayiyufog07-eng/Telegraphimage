import { jsonResponse } from '../../../utils/http.js';
import {
  authAvailable,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  deleteUserSessions,
  hashPassword,
  validatePassword,
} from '../../../utils/users.js';

// 管理员用户管理（由 ../_middleware.js 的 BASIC 鉴权保护）：
//   GET  /api/manage/users           → 用户列表
//   POST /api/manage/users/disable   { username }
//   POST /api/manage/users/enable    { username }
//   POST /api/manage/users/reset     { username, password }
//   POST /api/manage/users/delete    { username }

function unavailable() {
  return jsonResponse({
    error: 'auth_unavailable',
    message: '用户系统未启用：需要绑定名为 img_url 的 KV 命名空间。',
  }, { status: 503 });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!authAvailable(env)) return unavailable();

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const result = await listUsers(env, { cursor });

  return jsonResponse({
    users: result.users,
    cursor: result.cursor,
    complete: result.complete,
  });
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  if (!authAvailable(env)) return unavailable();

  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const allowed = ['disable', 'enable', 'reset', 'delete'];
  if (!allowed.includes(action)) {
    return jsonResponse({ error: 'unknown_action', message: '不支持的操作。' }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) {
    return jsonResponse({ error: 'bad_request', message: '缺少用户名。' }, { status: 400 });
  }

  const user = await getUser(env, username);
  if (!user) {
    return jsonResponse({ error: 'user_not_found', message: '用户不存在。' }, { status: 404 });
  }

  if (action === 'delete') {
    await deleteUser(env, username);
    await deleteUserSessions(env, username);
    return jsonResponse({ ok: true, username, action });
  }

  if (action === 'reset') {
    const password = typeof body.password === 'string' ? body.password : '';
    const passwordError = validatePassword(password);
    if (passwordError) {
      return jsonResponse({ error: 'invalid_password', message: passwordError }, { status: 400 });
    }
    const { salt, hash, iterations } = await hashPassword(password);
    user.salt = salt;
    user.passHash = hash;
    user.iterations = iterations;
    await updateUser(env, user);
    return jsonResponse({ ok: true, username, action });
  }

  // disable / enable
  user.disabled = action === 'disable';
  await updateUser(env, user);
  return jsonResponse({ ok: true, username, action, disabled: user.disabled });
}
