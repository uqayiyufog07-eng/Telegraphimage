import { authenticateWebDAV } from '../utils/webdav-auth.js';
import {
  webdavOptionsResponse,
  multistatusResponse,
  renderMultistatus,
  parsePropfind,
  buildWebdavHref,
} from '../utils/webdav-xml.js';
import {
  normalizeFileKey,
  normalizeDirPrefix,
  isFolderKey,
  listAllObjects,
  basename,
  dirname,
} from '../utils/r2-paths.js';

const MOUNT_PREFIX = '/webdav';
const MAX_DEPTH = 3; // PROPFIND infinity 最大递归深度

// WebDAV 协议入口：catch-all 路由，处理全部 WebDAV 方法。
// 路径：/webdav/<任意深度路径>
export async function onRequest(context) {
  const { request, env } = context;

  // 鉴权
  const authFail = authenticateWebDAV(request, env);
  if (authFail) return authFail;

  // 检查 R2 绑定
  if (!env.img_r2) {
    return new Response('R2 bucket (img_r2) is not bound', { status: 503 });
  }

  const method = request.method.toUpperCase();

  switch (method) {
    case 'OPTIONS':
      return webdavOptionsResponse();
    case 'PROPFIND':
      return handlePropfind(context);
    case 'GET':
    case 'HEAD':
      return handleGet(context, method === 'HEAD');
    case 'PUT':
      return handlePut(context);
    case 'DELETE':
      return handleDelete(context);
    case 'MKCOL':
      return handleMkcol(context);
    case 'MOVE':
      return handleMove(context, false);
    case 'COPY':
      return handleMove(context, true);
    case 'PROPPATCH':
      // 简化：返回空 multistatus 表示成功（很多客户端不需要真正修改属性）
      return multistatusResponse([]);
    default:
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Allow': 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY' },
      });
  }
}

// PROPFIND：列目录或获取资源属性
async function handlePropfind(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const resourcePath = decodeResourcePath(url.pathname);
  const depth = (request.headers.get('Depth') || '1').toLowerCase();

  const dirPrefix = normalizeDirPrefix(resourcePath);
  const fileKey = normalizeFileKey(resourcePath);

  const entries = [];

  // 判断请求的是文件还是目录
  // 1) 显式以 / 结尾 -> 目录
  // 2) 否则先 head 文件
  const isExplicitDir = resourcePath.endsWith('/') || resourcePath === '';

  if (!isExplicitDir) {
    const fileHead = await env.img_r2.head(fileKey);
    if (fileHead && !isFolderKey(fileKey)) {
      // 单个文件
      entries.push({
        href: buildWebdavHref(MOUNT_PREFIX, fileKey, false),
        isCollection: false,
        size: fileHead.size,
        lastModified: fileHead.uploaded,
        etag: fileHead.etag,
        contentType: fileHead.httpMetadata?.contentType || '',
      });
      return multistatusResponse(entries);
    }
  }

  // 目录：检查目录标记是否存在（可选，不强制）
  // 列目录内容
  if (depth === '0') {
    // 仅返回目录自身
    entries.push({
      href: buildWebdavHref(MOUNT_PREFIX, dirPrefix, true),
      isCollection: true,
      size: 0,
      lastModified: new Date(),
    });
    return multistatusResponse(entries);
  }

  // depth === '1' 或 'infinity'
  const wantInfinity = depth === 'infinity';
  entries.push({
    href: buildWebdavHref(MOUNT_PREFIX, dirPrefix, true),
    isCollection: true,
    size: 0,
    lastModified: new Date(),
  });

  // 列出当前层级
  const listOpts = {
    limit: 1000,
    delimiter: '/',
    include: ['httpMetadata', 'customMetadata'],
  };
  if (dirPrefix) listOpts.prefix = dirPrefix;

  let cursor = undefined;
  let depthLevel = 0;
  do {
    if (wantInfinity && depthLevel >= MAX_DEPTH) break;
    const page = await env.img_r2.list({ ...listOpts, cursor });

    // 子目录
    for (const prefix of page.delimitedPrefixes || []) {
      const dirName = dirPrefix ? prefix.slice(dirPrefix.length).replace(/\/+$/, '') : prefix.replace(/\/+$/, '');
      entries.push({
        href: buildWebdavHref(MOUNT_PREFIX, prefix, true),
        isCollection: true,
        size: 0,
        lastModified: new Date(),
      });

      // infinity: 递归列子目录（受 MAX_DEPTH 限制）
      if (wantInfinity && depthLevel < MAX_DEPTH - 1) {
        await collectInfinity(env, prefix, entries, depthLevel + 1);
      }
    }

    // 文件
    for (const obj of page.objects) {
      if (isFolderKey(obj.key)) continue;
      entries.push({
        href: buildWebdavHref(MOUNT_PREFIX, obj.key, false),
        isCollection: false,
        size: obj.size,
        lastModified: obj.uploaded,
        etag: obj.etag,
        contentType: obj.httpMetadata?.contentType || '',
      });
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && !wantInfinity);

  return multistatusResponse(entries);
}

async function collectInfinity(env, prefix, entries, level) {
  if (level >= MAX_DEPTH) return;
  const listOpts = {
    limit: 1000,
    delimiter: '/',
    prefix,
    include: ['httpMetadata', 'customMetadata'],
  };
  let cursor = undefined;
  do {
    const page = await env.img_r2.list({ ...listOpts, cursor });
    for (const subPrefix of page.delimitedPrefixes || []) {
      entries.push({
        href: buildWebdavHref(MOUNT_PREFIX, subPrefix, true),
        isCollection: true,
        size: 0,
        lastModified: new Date(),
      });
      await collectInfinity(env, subPrefix, entries, level + 1);
    }
    for (const obj of page.objects) {
      if (isFolderKey(obj.key)) continue;
      entries.push({
        href: buildWebdavHref(MOUNT_PREFIX, obj.key, false),
        isCollection: false,
        size: obj.size,
        lastModified: obj.uploaded,
        etag: obj.etag,
        contentType: obj.httpMetadata?.contentType || '',
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// GET / HEAD：下载文件
async function handleGet(context, headOnly) {
  const { request, env } = context;
  const url = new URL(request.url);
  const resourcePath = decodeResourcePath(url.pathname);
  const fileKey = normalizeFileKey(resourcePath);

  if (!fileKey) {
    return new Response('Forbidden: cannot GET directory', { status: 403 });
  }

  const obj = headOnly
    ? await env.img_r2.head(fileKey)
    : await env.img_r2.get(fileKey, { onlyIf: request.headers });

  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  if (typeof obj.writeHttpMetadata === 'function') {
    obj.writeHttpMetadata(headers);
  }
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(obj.size));
  headers.set('Last-Modified', obj.uploaded ? obj.uploaded.toUTCString() : '');

  if (headOnly) {
    return new Response(null, { status: 200, headers });
  }

  return new Response(obj.body, { status: 200, headers });
}

// PUT：上传/覆盖文件
async function handlePut(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const resourcePath = decodeResourcePath(url.pathname);
  const fileKey = normalizeFileKey(resourcePath);

  if (!fileKey) {
    return new Response('Forbidden: cannot PUT to root', { status: 403 });
  }

  if (resourcePath.endsWith('/')) {
    return new Response('Cannot PUT to a directory path; use MKCOL', { status: 405 });
  }

  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  const body = request.body;

  await env.img_r2.put(fileKey, body, {
    httpMetadata: { contentType },
  });

  return new Response(null, { status: 201 });
}

// DELETE：删除文件或文件夹
async function handleDelete(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const resourcePath = decodeResourcePath(url.pathname);

  if (!resourcePath) {
    return new Response('Forbidden: cannot delete root', { status: 403 });
  }

  const fileKey = normalizeFileKey(resourcePath);
  const dirPrefix = normalizeDirPrefix(resourcePath);

  // 尝试文件
  const fileHead = await env.img_r2.head(fileKey);
  if (fileHead && !isFolderKey(fileKey)) {
    await env.img_r2.delete(fileKey);
    return new Response(null, { status: 204 });
  }

  // 文件夹：递归删除
  const objects = await listAllObjects(env.img_r2, dirPrefix, 10000);
  const keys = objects.map(o => o.key);
  if (!keys.includes(dirPrefix)) keys.push(dirPrefix);

  for (let i = 0; i < keys.length; i += 1000) {
    await env.img_r2.delete(keys.slice(i, i + 1000));
  }

  return new Response(null, { status: 204 });
}

// MKCOL：创建文件夹
async function handleMkcol(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const resourcePath = decodeResourcePath(url.pathname);
  const dirPrefix = normalizeDirPrefix(resourcePath);

  if (!dirPrefix) {
    return new Response('Forbidden: cannot MKCOL root', { status: 403 });
  }

  // 检查是否已存在
  const existing = await env.img_r2.head(dirPrefix);
  if (existing) {
    return new Response('Method Not Allowed: already exists', { status: 405 });
  }
  const fileKey = dirPrefix.replace(/\/+$/, '');
  const existingFile = await env.img_r2.head(fileKey);
  if (existingFile) {
    return new Response('Conflict: file with same name exists', { status: 409 });
  }

  await env.img_r2.put(dirPrefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });

  return new Response(null, { status: 201 });
}

// MOVE / COPY：移动或复制
async function handleMove(context, isCopy) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sourcePath = decodeResourcePath(url.pathname);

  const destination = request.headers.get('Destination');
  if (!destination) {
    return new Response('Missing Destination header', { status: 400 });
  }

  let destUrl;
  try {
    destUrl = new URL(destination);
  } catch {
    return new Response('Invalid Destination header', { status: 400 });
  }

  const destPath = decodeResourcePath(destUrl.pathname);
  if (!destPath) {
    return new Response('Invalid destination path', { status: 400 });
  }

  const overwrite = (request.headers.get('Overwrite') || 'T').toUpperCase() !== 'F';

  // 判断源类型
  const srcFileKey = normalizeFileKey(sourcePath);
  const srcDirPrefix = normalizeDirPrefix(sourcePath);

  const srcFileHead = await env.img_r2.head(srcFileKey);
  let isFolder = false;

  if (srcFileHead && !isFolderKey(srcFileKey)) {
    // 文件
    const destFileKey = normalizeFileKey(destPath);
    if (destFileKey === srcFileKey) {
      return new Response('Source and destination are the same', { status: 403 });
    }

    const destHead = await env.img_r2.head(destFileKey);
    if (destHead && !overwrite) {
      return new Response('Precondition Failed: destination exists', { status: 412 });
    }

    const src = await env.img_r2.get(srcFileKey);
    await env.img_r2.put(destFileKey, src.body, {
      httpMetadata: src.httpMetadata || {},
      customMetadata: src.customMetadata || {},
    });

    if (destHead) await env.img_r2.delete(destFileKey); // 覆盖：先写后删旧（实际 put 已覆盖）

    if (!isCopy) {
      await env.img_r2.delete(srcFileKey);
    }

    return new Response(null, { status: destHead ? 204 : 201 });
  }

  // 文件夹
  const dirHead = await env.img_r2.head(srcDirPrefix);
  const children = await listAllObjects(env.img_r2, srcDirPrefix, 10000);
  if (!dirHead && children.length === 0) {
    return new Response('Source not found', { status: 404 });
  }
  isFolder = true;

  const destDirPrefix = normalizeDirPrefix(destPath);
  const destDirHead = await env.img_r2.head(destDirPrefix);
  if (destDirHead && !overwrite) {
    return new Response('Precondition Failed: destination exists', { status: 412 });
  }

  // 若覆盖且目标是文件夹，先递归删除目标
  if (destDirHead) {
    const destChildren = await listAllObjects(env.img_r2, destDirPrefix, 10000);
    const destKeys = destChildren.map(o => o.key);
    if (!destKeys.includes(destDirPrefix)) destKeys.push(destDirPrefix);
    for (let i = 0; i < destKeys.length; i += 1000) {
      await env.img_r2.delete(destKeys.slice(i, i + 1000));
    }
  }

  // 复制每个子对象
  for (const obj of children) {
    const relativeKey = obj.key.slice(srcDirPrefix.length);
    const newKey = destDirPrefix + relativeKey;
    const src = await env.img_r2.get(obj.key);
    if (!src) continue;
    await env.img_r2.put(newKey, src.body, {
      httpMetadata: obj.httpMetadata || {},
      customMetadata: obj.customMetadata || {},
    });
  }

  // 创建目标文件夹标记
  await env.img_r2.put(destDirPrefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });

  if (!isCopy) {
    // 删除源
    const oldKeys = children.map(o => o.key);
    if (dirHead) oldKeys.push(srcDirPrefix);
    for (let i = 0; i < oldKeys.length; i += 1000) {
      await env.img_r2.delete(oldKeys.slice(i, i + 1000));
    }
  }

  return new Response(null, { status: destDirHead ? 204 : 201 });
}

// 从 URL pathname 解码出 WebDAV 资源路径（去掉 /webdav 前缀，URL 解码）
function decodeResourcePath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith(MOUNT_PREFIX)) {
    p = p.slice(MOUNT_PREFIX.length);
  }
  p = p.replace(/^\/+/, '');
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}
