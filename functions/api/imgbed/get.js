import { jsonResponse, isEmptyBinding } from '../../utils/http.js';
import { getMetadata } from '../../utils/metadata.js';
import { r2Provider } from '../../storage/index.js';

// 单文件详情：GET /api/imgbed/get?id=xxx
export async function onRequestGet(context) {
  const { request, env } = context;

  if (isEmptyBinding(env.img_url)) {
    return jsonResponse({ error: 'kv_unbound' }, { status: 503 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return jsonResponse({ error: 'missing_id' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const metadata = await getMetadata(env, id);
  if (!metadata) {
    return jsonResponse({ error: 'not_found', message: '文件不存在。' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const provider = metadata.provider || (r2Provider.ownsId(id) ? 'r2' : 'telegram');

  return jsonResponse({
    id,
    fileName: metadata.fileName || id,
    fileSize: metadata.fileSize || 0,
    provider,
    timeStamp: metadata.TimeStamp || 0,
    shortId: metadata.shortId || null,
    liked: metadata.liked || false,
    ListType: metadata.ListType || 'None',
    Label: metadata.Label || 'None',
    src: `/file/${metadata.shortId || id}`,
  }, { headers: { 'Cache-Control': 'no-store' } });
}