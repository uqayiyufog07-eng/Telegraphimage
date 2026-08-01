import { jsonResponse } from '../../utils/http.js';
import { normalizeDirPrefix, normalizeFileKey, isFolderKey, listAllObjects } from '../../utils/r2-paths.js';
import { moveToTrash, trashR2Prefix } from '../../utils/trash.js';

// 删除文件或文件夹：DELETE /netdisk/api/delete?path=docs/file.txt
//   - 默认软删除：移入回收站（R2 __trash__/ 前缀 + KV trash:{id} 记录），可恢复
//   - permanent=true：物理删除，不进回收站
// 也支持 POST（body JSON { path: "...", permanent?: boolean }）便于前端调用。
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let rawPath = url.searchParams.get('path') || '';
  let permanent = url.searchParams.get('permanent') === 'true';

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (!rawPath) rawPath = body.path || '';
      if (body.permanent === true) permanent = true;
    } catch {
      // ignore
    }
  }

  if (!rawPath) {
    return jsonResponse({ error: 'Missing "path" parameter' }, { status: 400 });
  }

  // 回收站内部路径不允许通过此接口操作
  if (normalizeFileKey(rawPath).startsWith(trashR2Prefix()) || normalizeDirPrefix(rawPath).startsWith(trashR2Prefix())) {
    return jsonResponse({ error: 'Cannot delete items inside the trash. Use /netdisk/api/trash instead.' }, { status: 400 });
  }

  const dirPrefix = normalizeDirPrefix(rawPath);
  const fileKey = normalizeFileKey(rawPath);

  // 先判断是文件还是文件夹
  const isExplicitFolder = rawPath.endsWith('/');
  let targetIsFolder = isExplicitFolder;

  if (!isExplicitFolder) {
    const fileHead = await env.img_r2.head(fileKey);
    if (fileHead && !isFolderKey(fileKey)) {
      // 是文件
      if (permanent) {
        await env.img_r2.delete(fileKey);
        return jsonResponse({ success: true, deleted: [fileKey], type: 'file', permanent: true });
      }
      const record = await moveToTrash(env, { fileKey, isFolder: false });
      return jsonResponse({ success: true, trashed: true, trashId: record.id, type: 'file', path: fileKey });
    }
    // 检查是否是文件夹标记
    const dirHead = await env.img_r2.head(dirPrefix);
    if (dirHead) {
      targetIsFolder = true;
    }
  }

  if (permanent) {
    return await hardDeleteFolder(env, dirPrefix);
  }

  // 软删除文件夹：整体移入回收站
  const children = await listAllObjects(env.img_r2, dirPrefix, 1);
  const dirHead = await env.img_r2.head(dirPrefix);
  if (!dirHead && children.length === 0) {
    return jsonResponse({ error: 'Path not found', path: rawPath }, { status: 404 });
  }

  const record = await moveToTrash(env, { dirPrefix, isFolder: true });
  return jsonResponse({
    success: true,
    trashed: true,
    trashId: record.id,
    type: 'folder',
    path: dirPrefix,
    fileCount: record.fileCount,
  });
}

async function hardDeleteFolder(env, dirPrefix) {
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
    permanent: true,
    deletedCount: keysToDelete.length,
    deleted: keysToDelete,
  });
}
