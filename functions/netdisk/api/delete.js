import { jsonResponse } from '../../utils/http.js';
import { normalizeDirPrefix, normalizeFileKey, isFolderKey, listAllObjects } from '../../utils/r2-paths.js';

// 删除文件或文件夹：DELETE /netdisk/api/delete?path=docs/file.txt
//   - 文件：直接删除该 key
//   - 文件夹：递归列出所有以该前缀开头的对象并删除，同时删除文件夹标记
// 也支持 POST（body JSON { path: "..." }）便于前端调用。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let rawPath = url.searchParams.get('path') || '';

  if (!rawPath && request.method === 'POST') {
    try {
      const body = await request.json();
      rawPath = body.path || '';
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
  // 1) 若以 "/" 结尾或路径是已知目录标记 -> 文件夹删除
  // 2) 尝试 head 文件 key -> 文件删除
  // 3) 尝试 head 目录标记 -> 文件夹删除
  // 4) 都不存在，但可能有以该前缀开头的对象 -> 按文件夹递归删

  const isExplicitFolder = rawPath.endsWith('/');
  let targetIsFolder = isExplicitFolder;

  if (!isExplicitFolder) {
    const fileHead = await env.img_r2.head(fileKey);
    if (fileHead && !isFolderKey(fileKey)) {
      // 是文件
      await env.img_r2.delete(fileKey);
      return jsonResponse({ success: true, deleted: [fileKey], type: 'file' });
    }
    // 检查是否是文件夹标记
    const dirHead = await env.img_r2.head(dirPrefix);
    if (dirHead) {
      targetIsFolder = true;
    }
  }

  // 文件夹删除：递归列出并删除
  const objects = await listAllObjects(env.img_r2, dirPrefix, 10000);
  const keysToDelete = objects.map(o => o.key);

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
