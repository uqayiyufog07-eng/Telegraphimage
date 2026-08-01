import { jsonResponse } from '../../utils/http.js';
import { normalizeDirPrefix } from '../../utils/r2-paths.js';

// 创建文件夹：PUT/POST /netdisk/api/mkdir?path=docs/new
// R2 通过创建以 "/" 结尾的空对象来标记文件夹存在（便于区分空目录与不存在的目录）。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rawPath = url.searchParams.get('path') || '';
  const dirPrefix = normalizeDirPrefix(rawPath);

  if (!dirPrefix) {
    return jsonResponse({ error: 'Cannot create root directory' }, { status: 400 });
  }

  // 检查是否已存在
  const existing = await env.img_r2.head(dirPrefix);
  if (existing) {
    return jsonResponse({ error: 'Directory already exists', path: dirPrefix }, { status: 409 });
  }

  // 同时检查是否有同名文件
  const fileKey = dirPrefix.replace(/\/+$/, '');
  const existingFile = await env.img_r2.head(fileKey);
  if (existingFile) {
    return jsonResponse({ error: 'A file with this name already exists', path: fileKey }, { status: 409 });
  }

  await env.img_r2.put(dirPrefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });

  return jsonResponse({ success: true, path: dirPrefix, type: 'folder' });
}
