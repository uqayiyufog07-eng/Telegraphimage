import { jsonResponse } from '../../utils/http.js';
import {
  authAvailable,
  getSiteSettings,
  setSiteSettings,
  getRegistrationMode,
  listInviteCodes,
} from '../../utils/users.js';
import { listWebDAVAccounts } from '../../utils/webdav-auth.js';

// 站点设置：GET / POST /api/manage/site-settings
export async function onRequestGet(context) {
  const { env } = context;
  if (!authAvailable(env)) {
    return jsonResponse({ error: 'auth_unavailable', message: '用户系统未启用' }, { status: 503 });
  }
  const settings = await getSiteSettings(env);
  const invites = await listInviteCodes(env);
  let webdavCount = 0;
  try {
    const accounts = await listWebDAVAccounts(env);
    webdavCount = accounts.length;
  } catch {
    // KV 不可用时忽略
  }
  return jsonResponse({
    registrationMode: settings.registrationMode,
    updatedAt: settings.updatedAt,
    inviteCount: invites.codes.length,
    webdavAccountCount: webdavCount,
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!authAvailable(env)) {
    return jsonResponse({ error: 'auth_unavailable', message: '用户系统未启用' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  const mode = typeof body.registrationMode === 'string' ? body.registrationMode : '';
  const allowed = ['open', 'invite', 'closed'];
  if (!allowed.includes(mode)) {
    return jsonResponse({ error: 'invalid_mode', message: '注册模式必须是 open / invite / closed 之一。' }, { status: 400 });
  }

  await setSiteSettings(env, { registrationMode: mode });
  const settings = await getSiteSettings(env);
  return jsonResponse({ ok: true, registrationMode: settings.registrationMode, updatedAt: settings.updatedAt });
}
