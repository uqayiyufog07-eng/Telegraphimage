import { jsonResponse } from '../../utils/http.js';
import { normalizeFileKey, normalizeDirPrefix, isFolderKey, listAllObjects } from '../../utils/r2-paths.js';

// 重命名/移动：POST /netdisk/api/rename
// Body JSON: { from: "docs/old.txt", to: "docs/new.txt" }
//   - 文件：get + put(copy) + delete
//   - 文件夹：递归列出，逐个 get + put + delete，最后删除旧文件夹标记并创建新标记
// R2 无原生 move，必须复制后删除。
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const from = body.from;
  const to = body.to;
  if (!from || !to) {
    return jsonResponse({ error: 'Missing "from" or "to" field' }, { status: 400 });
  }

  // 判断源是文件还是文件夹
  const fromFileKey = normalizeFileKey(from);
  const fromDirPrefix = normalizeDirPrefix(from);

  // 优先检查文件
  const fileHead = await env.img_r2.head(fromFileKey);
  if (fileHead && !isFolderKey(fromFileKey)) {
    // 移动单个文件
    return await moveSingleFile(env, fromFileKey, normalizeFileKey(to), fileHead);
  }

  // 检查文件夹标记或该前缀下是否有对象
  const dirHead = await env.img_r2.head(fromDirPrefix);
  const children = await listAllObjects(env.img_r2, fromDirPrefix, 10000);
  if (!dirHead && children.length === 0) {
    return jsonResponse({ error: 'Source path does not exist', from }, { status: 404 });
  }

  // 移动文件夹
  const toDirPrefix = normalizeDirPrefix(to);
  const movedKeys = [];

  for (const obj of children) {
    const relativeKey = obj.key.slice(fromDirPrefix.length);
    const newKey = toDirPrefix + relativeKey;
    const src = await env.img_r2.get(obj.key);
    if (!src) continue;

    await env.img_r2.put(newKey, src.body, {
      httpMetadata: obj.httpMetadata || {},
      customMetadata: obj.customMetadata || {},
    });
    movedKeys.push({ from: obj.key, to: newKey });
  }

  // 删除旧对象
  const oldKeys = children.map(o => o.key);
  if (dirHead) oldKeys.push(fromDirPrefix);
  for (let i = 0; i < oldKeys.length; i += 1000) {
    await env.img_r2.delete(oldKeys.slice(i, i + 1000));
  }

  // 创建新文件夹标记
  await env.img_r2.put(toDirPrefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });

  return jsonResponse({
    success: true,
    type: 'folder',
    movedCount: movedKeys.length,
    moved: movedKeys,
  });
}

async function moveSingleFile(env, fromKey, toKey, headInfo) {
  if (fromKey === toKey) {
    return jsonResponse({ error: 'Source and destination are the same' }, { status: 400 });
  }

  // 检查目标是否已存在
  const toHead = await env.img_r2.head(toKey);
  if (toHead) {
    return jsonResponse({ error: 'Destination already exists', to: toKey }, { status: 409 });
  }

  const src = await env.img_r2.get(fromKey);
  if (!src) {
    return jsonResponse({ error: 'Source file not found', from: fromKey }, { status: 404 });
  }

  await env.img_r2.put(toKey, src.body, {
    httpMetadata: src.httpMetadata || {},
    customMetadata: src.customMetadata || {},
  });
  await env.img_r2.delete(fromKey);

  return jsonResponse({ success: true, type: 'file', from: fromKey, to: toKey });
}
