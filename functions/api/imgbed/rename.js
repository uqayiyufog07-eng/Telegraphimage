import { jsonResponse, isEmptyBinding } from '../../utils/http.js';
import { getMetadata, updateMetadata } from '../../utils/metadata.js';

// 重命名：POST /api/imgbed/rename  { id, fileName }
export async function onRequestPost(context) {
  const { request, env } = context;

  if (isEmptyBinding(env.img_url)) {
    return jsonResponse({ error: 'kv_unbound' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, { status: 400 });
  }

  const id = body && body.id;
  if (!id || typeof id !== 'string') {
    return jsonResponse({ error: 'missing_id' }, { status: 400 });
  }

  const fileName = body && body.fileName;
  if (!fileName || typeof fileName !== 'string') {
    return jsonResponse({ error: 'missing_fileName' }, { status: 400 });
  }

  const existing = await getMetadata(env, id);
  if (!existing) {
    return jsonResponse({ error: 'not_found', message: '文件不存在。' }, { status: 404 });
  }

  const updated = await updateMetadata(env, id, (meta) => ({ ...meta, fileName }));

  return jsonResponse({
    ok: true,
    id,
    fileName: updated ? updated.fileName : fileName,
  }, { headers: { 'Cache-Control': 'no-store' } });
}