import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  getRegistrationMode,
  isFirstUser,
  validateUsername,
  validatePassword,
  getUser,
  createUser,
  updateUser,
  createSession,
  sessionCookieHeader,
  publicUser,
  validateInviteCode,
  consumeInviteCode,
} from '../../utils/users.js';

// 注册：POST /api/auth/register  { username, password, inviteCode? }
// 三档注册模式：open（开放）/ invite（邀请码）/ closed（关闭）
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!authAvailable(env)) {
    return jsonResponse({
      error: 'auth_unavailable',
      message: '用户系统未启用：需要绑定名为 img_url 的 KV 命名空间。',
    }, { status: 503 });
  }

  const mode = await getRegistrationMode(env);

  if (mode === 'closed') {
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

  // 邀请码模式：校验邀请码
  if (mode === 'invite') {
    const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
    if (!inviteCode) {
      return jsonResponse({
        error: 'invite_code_required',
        field: 'inviteCode',
        message: '本站采用邀请码注册，请输入有效的邀请码。',
      }, { status: 400 });
    }
    const check = await validateInviteCode(env, inviteCode);
    if (!check.valid) {
      const messages = {
        not_found: '邀请码不存在。',
        disabled: '该邀请码已被停用。',
        expired: '该邀请码已过期。',
        exhausted: '该邀请码的使用次数已用尽。',
      };
      return jsonResponse({
        error: 'invalid_invite_code',
        field: 'inviteCode',
        message: messages[check.reason] || '邀请码无效。',
      }, { status: 400 });
    }
    // 暂存，注册成功后消费
    var validInviteCode = check.record.code;
  }

  const existing = await getUser(env, username);
  if (existing) {
    return jsonResponse({
      error: 'username_taken',
      message: '该用户名已被注册，换一个试试。',
    }, { status: 409 });
  }

  // 首用户自动成为管理员
  const firstUser = await isFirstUser(env);
  const record = await createUser(env, username, password);
  if (firstUser) {
    record.role = 'admin';
    await updateUser(env, record);
  }
  record.lastLoginAt = new Date().toISOString();
  await updateUser(env, record);

  // 消费邀请码
  if (mode === 'invite' && validInviteCode) {
    await consumeInviteCode(env, validInviteCode, username);
  }

  const token = await createSession(env, username);

  return jsonResponse({ ok: true, user: publicUser(record) }, {
    headers: { 'Set-Cookie': sessionCookieHeader(request, token) },
  });
}
