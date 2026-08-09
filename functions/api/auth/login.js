import { jsonResponse } from '../../utils/http.js';
import {
  ownerPasswordSet,
  resolveOwnerPassword,
  ownerLoginResponse,
} from '../../utils/owner-auth.js';

// 所有者登录：POST /api/auth/login  { password }
// 单密码模式，无用户名、无注册、无锁定（单所有者）。
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!ownerPasswordSet(env)) {
    return jsonResponse({
      error: 'auth_not_configured',
      message: '未配置所有者密码（OWNER_PASSWORD 或 BASIC_PASS）。',
    }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return jsonResponse({ error: 'bad_request', message: '请输入密码。' }, { status: 400 });
  }

  const expected = resolveOwnerPassword(env);
  if (!timingSafeEqual(password, expected)) {
    return jsonResponse({ error: 'invalid_password', message: '密码不正确。' }, { status: 401 });
  }

  return ownerLoginResponse(request, env, { ok: true });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
