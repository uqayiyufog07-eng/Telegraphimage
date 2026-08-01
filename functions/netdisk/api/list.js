import { jsonResponse } from '../../utils/http.js';
import { normalizeDirPrefix, parseListResult, displayName } from '../../utils/r2-paths.js';

// 列目录：GET /netdisk/api/list?path=docs&cursor=xxx
// 返回当前目录下的子目录和文件列表。
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const rawPath = url.searchParams.get('path') || '';
  const cursor = url.searchParams.get('cursor') || undefined;
  const dirPrefix = normalizeDirPrefix(rawPath);

  const listOpts = {
    limit: 1000,
    delimiter: '/',
    include: ['httpMetadata', 'customMetadata'],
  };
  if (dirPrefix) listOpts.prefix = dirPrefix;
  if (cursor) listOpts.cursor = cursor;

  const result = await env.img_r2.list(listOpts);
  const { directories, files } = parseListResult(result, dirPrefix);

  const items = [
    ...directories.map(name => ({
      name,
      type: 'folder',
      path: dirPrefix + name + '/',
      size: 0,
      modified: null,
    })),
    ...files.map(obj => ({
      name: displayName(obj.key, dirPrefix),
      type: 'file',
      path: obj.key,
      size: obj.size,
      modified: obj.uploaded ? obj.uploaded.toISOString() : null,
      contentType: obj.httpMetadata?.contentType || '',
      etag: obj.etag || '',
    })),
  ];

  // 排序：文件夹优先，再按名称
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });

  return jsonResponse({
    path: rawPath,
    items,
    truncated: result.truncated,
    cursor: result.truncated ? result.cursor : null,
  });
}
