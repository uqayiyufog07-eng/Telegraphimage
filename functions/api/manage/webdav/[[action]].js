import { jsonResponse } from '../../../utils/http.js';
import { isEmptyBinding } from '../../../utils/http.js';
import {
  listWebDAVAccounts,
  createWebDAVAccount,
  resetWebDAVAccount,
  deleteWebDAVAccount,
  disableWebDAVAccount,
  enableWebDAVAccount,
  hasAnyWebDAVAccount,
} from '../../../utils/webdav-auth.js';

// WebDAV 账号管理：
//   GET  /api/manage/webdav              → 状态 + 账号列表
//   POST /api/manage/webdav/create       { username, password }
//   POST /api/manage/webdav/reset        { username, password }
//   POST /api/manage/webdav/disable      { username }
//   POST /api/manage/webdav/enable       { username }
//   POST /api/manage/webdav/delete       { username }

function envHasWebDAVCreds(env) {
  const hasWebdav = !isEmptyBinding(env.WEBDAV_USER) && !isEmptyBinding(env.WEBDAV_PASS);
  const hasBasic = !isEmptyBinding(env.BASIC_USER) && !isEmptyBinding(env.BASIC_PASS);
  return hasWebdav || hasBasic;
}

export async function onRequestGet(context) {
  const { env } = context;
  const r2Enabled = !!env.img_r2;
  const accounts = r2Enabled ? await listWebDAVAccounts(env) : [];
  const kvAccounts = accounts.length > 0;
  const envFallback = envHasWebDAVCreds(env);

  return jsonResponse({
    enabled: r2Enabled,
    url: r2Enabled ? '/webdav' : null,
    authRequired: r2Enabled && (kvAccounts || envFallback),
    envFallback,
    accounts,
  });
}

export async function onRequestPost(context) {
  const { env, request, params } = context;

  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const allowed = ['create', 'reset', 'disable', 'enable', 'delete'];
  if (!action || !allowed.includes(action)) {
    return jsonResponse({ error: 'unknown_action', message: '不支持的操作。' }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', message: '请求格式不正确。' }, { status: 400 });
  }

  if (action === 'create') {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username) {
      return jsonResponse({ error: 'bad_request', message: '用户名不能为空。' }, { status: 400 });
    }
    try {
      const account = await createWebDAVAccount(env, username, password);
      return jsonResponse({ ok: true, account });
    } catch (err) {
      return jsonResponse({ error: 'create_failed', message: err.message }, { status: 400 });
    }
  }

  if (action === 'reset') {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username) {
      return jsonResponse({ error: 'bad_request', message: '用户名不能为空。' }, { status: 400 });
    }
    try {
      const account = await resetWebDAVAccount(env, username, password);
      return jsonResponse({ ok: true, account });
    } catch (err) {
      return jsonResponse({ error: 'reset_failed', message: err.message }, { status: 400 });
    }
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) {
    return jsonResponse({ error: 'bad_request', message: '用户名不能为空。' }, { status: 400 });
  }

  if (action === 'disable') {
    const ok = await disableWebDAVAccount(env, username);
    return jsonResponse({ ok, username });
  }
  if (action === 'enable') {
    const ok = await enableWebDAVAccount(env, username);
    return jsonResponse({ ok, username });
  }
  if (action === 'delete') {
    const ok = await deleteWebDAVAccount(env, username);
    return jsonResponse({ ok, username });
  }

  return jsonResponse({ error: 'unknown_action', message: '不支持的操作。' }, { status: 404 });
}
