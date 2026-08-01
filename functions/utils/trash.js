// 网盘回收站：删除的文件/文件夹先移动到 R2 的 __trash__/ 前缀下，
// 并在 KV 中记录 trash:{id} -> { id, type, name, originalPath, size, fileCount, deletedAt }。
// 回收站中的对象可以通过记录还原回原始路径，也可以彻底删除。
//
// R2 布局：__trash__/{id}/{原始 key}，因此从回收站 key 可以推导出原始 key，
// 无需在 KV 中存储大文件夹的完整 key 映射。

import { listAllObjects, basename } from './r2-paths.js';

const TRASH_R2_PREFIX = '__trash__/';
const TRASH_KV_PREFIX = 'trash:';
const DEFAULT_RETENTION_DAYS = 30;

export function trashR2Prefix() {
  return TRASH_R2_PREFIX;
}

export function isTrashR2Key(key) {
  return typeof key === 'string' && key.startsWith(TRASH_R2_PREFIX);
}

export function trashKvKey(id) {
  return TRASH_KV_PREFIX + id;
}

export function trashRetentionDays(env) {
  const n = Number(env.TRASH_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS;
}

function generateTrashId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return Date.now().toString(36) + rand;
}

async function putTrashRecord(env, record) {
  await env.img_url.put(trashKvKey(record.id), '', { metadata: record });
}

export async function getTrashRecord(env, id) {
  const record = await env.img_url.getWithMetadata(trashKvKey(id));
  return record?.metadata || null;
}

export async function deleteTrashRecord(env, id) {
  await env.img_url.delete(trashKvKey(id));
}

// R2 无原生 move：get + put + delete
async function moveObject(bucket, fromKey, toKey) {
  const src = await bucket.get(fromKey);
  if (!src) return false;
  await bucket.put(toKey, src.body, {
    httpMetadata: src.httpMetadata || {},
    customMetadata: src.customMetadata || {},
  });
  await bucket.delete(fromKey);
  return true;
}

// 将文件或文件夹移入回收站。返回回收站记录。
//   fileKey   - 文件场景下的完整 R2 key
//   dirPrefix - 文件夹场景下的目录前缀（以 "/" 结尾）
//   isFolder  - 是否按文件夹处理
export async function moveToTrash(env, { fileKey, dirPrefix, isFolder }) {
  if (!env.img_url) {
    throw new Error('Trash requires KV binding (img_url). Set permanent=true to delete directly.');
  }

  const id = generateTrashId();
  const trashBase = `${TRASH_R2_PREFIX}${id}/`;

  if (!isFolder) {
    const head = await env.img_r2.head(fileKey);
    if (!head) {
      throw new Error('File not found: ' + fileKey);
    }
    await moveObject(env.img_r2, fileKey, trashBase + fileKey);

    const record = {
      id,
      type: 'file',
      name: basename(fileKey),
      originalPath: fileKey,
      size: head.size || 0,
      fileCount: 1,
      deletedAt: Date.now(),
    };
    await putTrashRecord(env, record);
    return record;
  }

  // 文件夹：移动前缀下所有对象（包括文件夹标记本身）
  const children = await listAllObjects(env.img_r2, dirPrefix, 10000);
  let totalSize = 0;
  let moved = 0;
  for (const obj of children) {
    if (await moveObject(env.img_r2, obj.key, trashBase + obj.key)) {
      moved++;
      if (!obj.key.endsWith('/')) totalSize += obj.size || 0;
    }
  }
  // 文件夹标记可能不在 list 结果中（理论上会包含，防御一下）
  const dirHead = await env.img_r2.head(dirPrefix);
  if (dirHead) {
    await moveObject(env.img_r2, dirPrefix, trashBase + dirPrefix);
  }

  const record = {
    id,
    type: 'folder',
    name: basename(dirPrefix) || dirPrefix,
    originalPath: dirPrefix,
    size: totalSize,
    fileCount: moved,
    deletedAt: Date.now(),
  };
  await putTrashRecord(env, record);
  return record;
}

// 从回收站恢复。目标位置被占用时抛出 code === 'CONFLICT' 的错误。
export async function restoreTrashItem(env, id) {
  const record = await getTrashRecord(env, id);
  if (!record) return null;

  // 冲突检查：原位置已有内容时拒绝恢复，避免覆盖
  if (record.type === 'file') {
    const head = await env.img_r2.head(record.originalPath);
    if (head) throw conflictError(record.originalPath);
  } else {
    const peek = await env.img_r2.list({ prefix: record.originalPath, limit: 1 });
    if (peek.objects.length > 0) throw conflictError(record.originalPath);
  }

  const trashBase = `${TRASH_R2_PREFIX}${id}/`;
  const objects = await listAllObjects(env.img_r2, trashBase, 10000);
  let restored = 0;
  for (const obj of objects) {
    const originalKey = obj.key.slice(trashBase.length);
    if (!originalKey) continue;
    if (await moveObject(env.img_r2, obj.key, originalKey)) restored++;
  }

  await deleteTrashRecord(env, id);
  return { record, restored };
}

function conflictError(path) {
  const err = new Error('Original location is occupied: ' + path);
  err.code = 'CONFLICT';
  return err;
}

// 彻底删除单个回收站条目（R2 对象 + KV 记录）。返回删除的对象数。
export async function purgeTrashItem(env, id) {
  const trashBase = `${TRASH_R2_PREFIX}${id}/`;
  let removed = 0;

  // 先删 R2 对象
  try {
    const objects = await listAllObjects(env.img_r2, trashBase, 10000);
    const keys = objects.map(o => o.key);
    for (let i = 0; i < keys.length; i += 1000) {
      await env.img_r2.delete(keys.slice(i, i + 1000));
    }
    removed = keys.length;
  } catch (e) {
    console.error('purgeTrashItem: R2 delete failed for', id, e.message);
    // 继续删 KV 记录，避免残留
  }

  // 再删 KV 记录（即使 R2 删除失败也要尝试清理 KV）
  try {
    await deleteTrashRecord(env, id);
  } catch (e) {
    console.error('purgeTrashItem: KV delete failed for', id, e.message);
  }

  return removed;
}

// 列出回收站条目；同时惰性清理超过保留期的条目。
export async function listTrashItems(env) {
  const days = trashRetentionDays(env);
  const now = Date.now();
  const items = [];
  const expired = [];

  let cursor;
  do {
    const page = await env.img_url.list({ prefix: TRASH_KV_PREFIX, limit: 1000, cursor });
    for (const k of page.keys) {
      const meta = k.metadata;
      if (!meta || !meta.id) continue;
      if (days > 0 && meta.deletedAt && now - meta.deletedAt > days * 86400000) {
        expired.push(meta.id);
      } else {
        items.push(meta);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // 惰性清理过期条目
  for (const id of expired) {
    try {
      await purgeTrashItem(env, id);
    } catch (e) {
      console.error('purge expired trash item failed:', e.message);
    }
  }

  items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return items;
}

// 清空回收站：删除所有 KV 记录对应的对象，并兜底清理 __trash__/ 下的孤儿对象。
export async function emptyTrash(env) {
  const items = await listTrashItems(env);
  let removed = 0;
  for (const item of items) {
    try {
      removed += await purgeTrashItem(env, item.id);
    } catch (e) {
      console.error('emptyTrash: purge failed for', item.id, e.message);
    }
  }

  // 兜底：清理失去 KV 记录的孤儿对象
  try {
    const orphans = await listAllObjects(env.img_r2, TRASH_R2_PREFIX, 100000);
    const orphanKeys = orphans.map(o => o.key);
    for (let i = 0; i < orphanKeys.length; i += 1000) {
      await env.img_r2.delete(orphanKeys.slice(i, i + 1000));
    }
    removed += orphanKeys.length;
  } catch (e) {
    console.error('emptyTrash: orphan cleanup failed', e.message);
  }

  return removed;
}
