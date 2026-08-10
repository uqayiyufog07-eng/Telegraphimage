import { jsonResponse, isEmptyBinding } from '../../utils/http.js';
import { getMetadata } from '../../utils/metadata.js';
import { deleteShortLink } from '../../utils/shortlink.js';
import { dedupKey, deleteDedupEntry } from '../../utils/dedup.js';
import { r2Provider } from '../../storage/index.js';

// 删除图床文件：清理 KV 元数据 + R2 对象 + 去重记录 + 短链接映射。
// Telegram 端文件无法通过 API 删除（file_id 不携带 message_id），仅清理 KV 记录。
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

  // 读取元数据（用于关联清理去重记录和短链接）
  const metadata = await getMetadata(env, id);

  // 1. 删除 R2 对象（仅 R2 文件）
  if (r2Provider.ownsId(id) && !isEmptyBinding(env.img_r2)) {
    try {
      await env.img_r2.delete(id);
    } catch (err) {
      console.error('R2 delete failed:', err.message);
    }
  }

  // 2. 删除 KV 元数据
  await env.img_url.delete(id);

  // 3. 删除短链接映射
  if (metadata?.shortId) {
    try {
      await deleteShortLink(env, metadata.shortId);
    } catch (err) {
      console.error('Short link delete failed:', err.message);
    }
  }

  // 4. 删除去重记录（如果有 fileHash）
  if (metadata?.fileHash) {
    try {
      await deleteDedupEntry(env, dedupKey(metadata.fileHash));
    } catch (err) {
      console.error('Dedup entry delete failed:', err.message);
    }
  }

  return jsonResponse({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
}
