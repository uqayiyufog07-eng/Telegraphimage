import { jsonResponse } from '../../utils/http.js';
import { listTrashItems, purgeTrashItem, emptyTrash, trashRetentionDays } from '../../utils/trash.js';

// 回收站管理：
//   GET    /netdisk/api/trash           列出回收站条目（惰性清理过期条目）
//   DELETE /netdisk/api/trash?id=xxx    彻底删除单个条目
//   DELETE /netdisk/api/trash           清空回收站
// 恢复条目使用 POST /netdisk/api/restore。

function kvUnavailable() {
  return jsonResponse({ error: 'Trash requires KV binding (img_url). Please bind it in Pages settings.' }, { status: 503 });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.img_url) return kvUnavailable();

  const items = await listTrashItems(env);
  return jsonResponse({
    items,
    count: items.length,
    retentionDays: trashRetentionDays(env),
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.img_url) return kvUnavailable();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const removed = await purgeTrashItem(env, id);
    return jsonResponse({ success: true, id, removedObjects: removed });
  }

  const removed = await emptyTrash(env);
  return jsonResponse({ success: true, emptied: true, removedObjects: removed });
}
