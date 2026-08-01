import { jsonResponse } from '../../utils/http.js';
import { normalizeDirPrefix, normalizeFileKey, isFolderKey, listAllObjects } from '../../utils/r2-paths.js';

// 删除文件或文件夹：DELETE /netdisk/api/delete?path=docs/file.txt
// 直接物理删除，不进回收站。
// 也支持 POST（body JSON { path: "..." }）便于前端调用。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let rawPath = url.searchParams.get('path') || '';

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (!rawPath) rawPath = body.path || '';
    } catch {
      // ignore
    }
  }

  if (!rawPath) {
    return jsonResponse({ error: 'Missing "path" parameter' }, { status: 400 });
  }

  const dirPrefix = normalizeDirPrefix(rawPath);
  const fileKey = normalizeFileKey(rawPath);

  // 先判断是文件还是文件夹
  const isExplicitFolder = rawPath.endsWith('/');

  if (!isExplicitFolder) {
    const fileHead = await env.img_r2.head(fileKey);
    if (fileHead && !isFolderKey(fileKey)) {
      await env.img_r2.delete(fileKey);
      return jsonResponse({ success: true, deleted: [fileKey], type: 'file' });
    }
  }

  // 检查路径是否存在
  const dirHead = await env.img_r2.head(dirPrefix);
  if (!isExplicitFolder && !dirHead) {
    const children = await listAllObjects(env.img_r2, dirPrefix, 1);
    if (children.length === 0) {
      return jsonResponse({ error: 'Path not found', path: rawPath }, { status: 404 });
    }
  }

  // 文件夹删除
  const children = await listAllObjects(env.img_r2, dirPrefix, 10000);
  const keysToDelete = children.map(o => o.key);

  // 确保文件夹标记本身也被删除
  if (!keysToDelete.includes(dirPrefix)) {
    keysToDelete.push(dirPrefix);
  }

  // R2 delete 支持批量（最多 1000 个/次）
  for (let i = 0; i < keysToDelete.length; i += 1000) {
    const batch = keysToDelete.slice(i, i + 1000);
    await env.img_r2.delete(batch);
  }

  return jsonResponse({
    success: true,
    type: 'folder',
    deletedCount: keysToDelete.length,
    deleted: keysToDelete,
  });
}
