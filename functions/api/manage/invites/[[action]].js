import { jsonResponse } from '../../../utils/http.js';
import {
  authAvailable,
  listInviteCodes,
  createInviteCode,
  disableInviteCode,
  enableInviteCode,
  deleteInviteCode,
} from '../../../utils/users.js';

// 邀请码管理：
//   GET  /api/manage/invites           → 列表
//   POST /api/manage/invites/create    { maxUses?, expiresAt? }
//   POST /api/manage/invites/disable   { code }
//   POST /api/manage/invites/enable    { code }
//   POST /api/manage/invites/delete    { code }

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
  const result = await listInviteCodes(env, { cursor });

  return jsonResponse({
    codes: result.codes,
    cursor: result.cursor,
    complete: result.complete,
  });
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  if (!authAvailable(env)) return unavailable();

  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const allowed = ['create', 'disable', 'enable', 'delete'];
  if (!action || !allowed.includes(action)) {
    return jsonResponse({ error: 'unknown_action', message: '不支持的操作。' }, { status: 404 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // disable/enable/delete 也可能没有 body，但通常有 { code }
  }

  if (action === 'create') {
    const maxUses = body.maxUses ? Math.max(0, Number(body.maxUses) || 0) : 0;
    const expiresAt = body.expiresAt || null;
    const record = await createInviteCode(env, { maxUses, expiresAt, createdBy: null });
    return jsonResponse({ ok: true, code: record });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return jsonResponse({ error: 'bad_request', message: '缺少邀请码。' }, { status: 400 });
  }

  if (action === 'disable') {
    const ok = await disableInviteCode(env, code);
    return jsonResponse({ ok, code });
  }
  if (action === 'enable') {
    const ok = await enableInviteCode(env, code);
    return jsonResponse({ ok, code });
  }
  if (action === 'delete') {
    const ok = await deleteInviteCode(env, code);
    return jsonResponse({ ok, code });
  }

  return jsonResponse({ error: 'unknown_action', message: '不支持的操作。' }, { status: 404 });
}
