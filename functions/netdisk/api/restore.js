import { jsonResponse } from '../../utils/http.js';
import { restoreTrashItem } from '../../utils/trash.js';

// 从回收站恢复：POST /netdisk/api/restore
// Body JSON: { id: "<trashId>" }
// 原位置已被占用时返回 409。
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.img_url) {
    return jsonResponse({ error: 'Trash requires KV binding (img_url). Please bind it in Pages settings.' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = body.id;
  if (!id) {
    return jsonResponse({ error: 'Missing "id" field' }, { status: 400 });
  }

  try {
    const result = await restoreTrashItem(env, id);
    if (!result) {
      return jsonResponse({ error: 'Trash item not found', id }, { status: 404 });
    }
    return jsonResponse({
      success: true,
      id,
      restored: result.restored,
      path: result.record.originalPath,
      type: result.record.type,
    });
  } catch (err) {
    if (err.code === 'CONFLICT') {
      return jsonResponse({ error: err.message, code: 'CONFLICT' }, { status: 409 });
    }
    throw err;
  }
}
