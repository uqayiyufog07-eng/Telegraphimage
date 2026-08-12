import { jsonResponse, isEmptyBinding } from '../../utils/http.js';
import { isDedupKey } from '../../utils/dedup.js';
import { isShortLinkKey } from '../../utils/shortlink.js';
import { r2Provider } from '../../storage/index.js';

// 图床历史列表：分页列出 KV 中所有图床文件元数据。
// KV 中还存有短链接（short:）和去重（dedup:/nddedup:）键，需过滤掉。
const RESERVED_PREFIXES = ['short:', 'dedup:', 'nddedup:'];

function isReservedKey(name) {
  if (isDedupKey(name) || isShortLinkKey(name)) return true;
  return RESERVED_PREFIXES.some(p => name.startsWith(p));
}

// 旧文件可能没有 provider 字段，按 id 前缀推断：r2- 开头是 R2，否则视为 Telegram。
function inferProvider(id, metadata) {
  if (metadata.provider) return metadata.provider;
  return r2Provider.ownsId(id) ? 'r2' : 'telegram';
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    if (isEmptyBinding(env.img_url)) {
      return jsonResponse({ error: 'kv_unbound', items: [], list_complete: true });
    }

    const url = new URL(context.request.url);
    const cursor = url.searchParams.get('cursor') || undefined;
    const providerFilter = url.searchParams.get('provider') || '';

    const result = await env.img_url.list({ limit: 1000, cursor });
    const items = [];

    for (const entry of (result.keys || [])) {
      if (isReservedKey(entry.name)) continue;
      const meta = entry.metadata || {};
      const provider = inferProvider(entry.name, meta);
      if (providerFilter && provider !== providerFilter) continue;

      items.push({
        id: entry.name,
        fileName: meta.fileName || entry.name,
        fileSize: meta.fileSize || 0,
        provider,
        timeStamp: meta.TimeStamp || 0,
        shortId: meta.shortId || null,
        liked: meta.liked || false,
      });
    }

    // 按时间倒序（新上传在前）
    items.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));

    return jsonResponse({
      items,
      cursor: result.list_complete ? null : result.cursor,
      list_complete: result.list_complete,
      total: items.length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('imgbed list error:', err);
    return jsonResponse(
      { error: 'server_error', message: err.message || String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}