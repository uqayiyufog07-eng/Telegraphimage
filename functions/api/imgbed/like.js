import { jsonResponse, isEmptyBinding } from '../../utils/http.js';
import { getMetadata, updateMetadata } from '../../utils/metadata.js';

// 收藏切换：POST /api/imgbed/like  { id, liked? }
// 提供 liked 时按给定值设置；未提供时取反当前值。
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

  const existing = await getMetadata(env, id);
  if (!existing) {
    return jsonResponse({ error: 'not_found', message: '文件不存在。' }, { status: 404 });
  }

  const requested = body && typeof body.liked === 'boolean' ? body.liked : null;
  const newLiked = requested !== null ? requested : !(existing.liked || false);

  const updated = await updateMetadata(env, id, (meta) => ({ ...meta, liked: newLiked }));

  return jsonResponse({
    ok: true,
    id,
    liked: updated ? updated.liked : newLiked,
  }, { headers: { 'Cache-Control': 'no-store' } });
}