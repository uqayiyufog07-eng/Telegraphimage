import { jsonResponse } from '../../utils/http.js';
import { normalizeFileKey, normalizeDirPrefix, isFolderKey } from '../../utils/r2-paths.js';
import {
  generateToken,
  hashPassword,
  parseExpiry,
  createShareMetadata,
  putShare,
  getShare,
  deleteShare,
} from '../../utils/share-token.js';

// 分享管理：
//   POST /netdisk/api/share        创建分享
//        Body: { path: "docs/file.txt", password?: "secret", expiry?: "7d" }
//   GET  /netdisk/api/share?token=xxx   获取分享信息（不含密码）
//   DELETE /netdisk/api/share?token=xxx 删除分享

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawPath = body.path;
  if (!rawPath) {
    return jsonResponse({ error: 'Missing "path" field' }, { status: 400 });
  }

  const fileKey = normalizeFileKey(rawPath);
  const dirPrefix = normalizeDirPrefix(rawPath);

  // 判断类型：文件 / 文件夹
  let type = 'file';
  let targetKey = fileKey;

  if (rawPath.endsWith('/')) {
    type = 'folder';
    targetKey = dirPrefix;
  } else {
    const fileHead = await env.img_r2.head(fileKey);
    if (!fileHead || isFolderKey(fileKey)) {
      // 可能是文件夹
      const dirHead = await env.img_r2.head(dirPrefix);
      if (dirHead) {
        type = 'folder';
        targetKey = dirPrefix;
      } else {
        return jsonResponse({ error: 'Path not found', path: rawPath }, { status: 404 });
      }
    }
  }

  const password = body.password || '';
  const passwordHash = await hashPassword(password);
  const expiresAt = parseExpiry(body.expiry);

  const token = generateToken();
  const metadata = createShareMetadata({
    path: targetKey,
    type,
    passwordHash,
    expiresAt,
  });

  await putShare(env, token, metadata);

  return jsonResponse({
    success: true,
    token,
    shareUrl: `/share/${token}`,
    path: targetKey,
    type,
    hasPassword: !!password,
    expiresAt: expiresAt || 0,
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return jsonResponse({ error: 'Missing "token" parameter' }, { status: 400 });
  }

  const meta = await getShare(env, token);
  if (!meta) {
    return jsonResponse({ error: 'Share not found or deleted', token }, { status: 404 });
  }

  // 不返回 passwordHash
  return jsonResponse({
    token,
    path: meta.path,
    type: meta.type,
    hasPassword: !!meta.passwordHash,
    expiresAt: meta.expiresAt,
    createdAt: meta.createdAt,
    downloadCount: meta.downloadCount || 0,
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return jsonResponse({ error: 'Missing "token" parameter' }, { status: 400 });
  }

  await deleteShare(env, token);
  return jsonResponse({ success: true, token });
}
