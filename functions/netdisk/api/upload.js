import { jsonResponse } from '../../utils/http.js';
import { normalizeFileKey, normalizeDirPrefix, dirname, basename } from '../../utils/r2-paths.js';
import { ndDedupKey, getDedupEntry, putDedupEntry, deleteDedupEntry, hashFileContent, hashText } from '../../utils/dedup.js';

// 上传文件：POST /netdisk/api/upload?path=docs/sub
// 使用 multipart/form-data，文件字段名为 "file"（可多文件）。
// 也可通过 JSON { path, content } 上传文本文件。
//
// 内容去重：相同内容的文件已在网盘中存在时，服务端直接复制已有对象，
// 相同路径 + 相同内容则跳过写入。
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const dirPath = url.searchParams.get('path') || '';
  const dirPrefix = normalizeDirPrefix(dirPath);

  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('multipart/form-data') || contentType.includes('multipart/mixed')) {
    return await handleMultipartUpload(env, request, dirPrefix);
  }

  // JSON 文本上传（便捷接口）
  if (contentType.includes('application/json')) {
    return await handleJsonUpload(env, request, dirPrefix);
  }

  return jsonResponse({ error: 'Unsupported Content-Type. Use multipart/form-data or application/json.' }, { status: 400 });
}

async function handleMultipartUpload(env, request, dirPrefix) {
  const formData = await request.formData();
  const files = formData.getAll('file');
  if (!files || files.length === 0) {
    return jsonResponse({ error: 'No file provided (field name must be "file")' }, { status: 400 });
  }

  const results = [];
  for (const file of files) {
    if (!file || typeof file === 'string') continue;
    const fileName = file.name || `upload-${Date.now()}`;
    const key = normalizeFileKey(dirPrefix + fileName);
    if (!key) {
      results.push({ name: fileName, error: 'Invalid filename' });
      continue;
    }

    // 内容去重（需要 KV）
    const hash = env.img_url ? await hashFileContent(file) : null;
    if (hash) {
      const deduped = await tryDedupPut(env, hash, key, fileName, file.size, file.type);
      if (deduped) {
        results.push(deduped);
        continue;
      }
    }

    await env.img_r2.put(key, file.stream ? file.stream() : await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
      },
    });

    if (hash) {
      await putDedupEntry(env, ndDedupKey(hash), { key, size: file.size, fileName, updatedAt: Date.now() });
    }

    results.push({
      name: basename(key),
      key,
      size: file.size,
      path: key,
    });
  }

  return jsonResponse({ uploaded: results, count: results.length });
}

// 命中去重记录时返回结果对象；未命中或记录失效时返回 null（调用方走正常上传）。
async function tryDedupPut(env, hash, key, fileName, fileSize, contentType) {
  const existing = await getDedupEntry(env, ndDedupKey(hash));
  if (!existing?.key) return null;

  // 相同内容 + 相同路径：对象还在则直接跳过写入
  if (existing.key === key) {
    const head = await env.img_r2.head(key);
    if (head) {
      return { name: basename(key), key, path: key, size: fileSize, deduplicated: true, skipped: true };
    }
    await deleteDedupEntry(env, ndDedupKey(hash));
    return null;
  }

  // 相同内容在不同路径：服务端复制已有对象，避免重复上传存储
  const src = await env.img_r2.get(existing.key);
  if (!src) {
    // 源对象已不存在（被删除/移入回收站），清理失效记录
    await deleteDedupEntry(env, ndDedupKey(hash));
    return null;
  }

  await env.img_r2.put(key, src.body, {
    httpMetadata: {
      contentType: contentType || src.httpMetadata?.contentType || 'application/octet-stream',
    },
  });
  await putDedupEntry(env, ndDedupKey(hash), { key, size: fileSize, fileName, updatedAt: Date.now() });

  return { name: basename(key), key, path: key, size: fileSize, deduplicated: true, copiedFrom: existing.key };
}

async function handleJsonUpload(env, request, dirPrefix) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileName = body.name || body.filename;
  const content = body.content != null ? body.content : '';
  if (!fileName) {
    return jsonResponse({ error: 'Missing "name" field' }, { status: 400 });
  }

  const key = normalizeFileKey(dirPrefix + fileName);

  // 文本内容同样做去重（体量小，哈希开销可忽略）
  if (env.img_url) {
    const hash = await hashText(content);
    const deduped = await tryDedupPut(env, hash, key, fileName, String(content).length, body.contentType || 'text/plain');
    if (deduped) {
      return jsonResponse(deduped);
    }
    await env.img_r2.put(key, String(content), {
      httpMetadata: {
        contentType: body.contentType || 'text/plain',
      },
    });
    await putDedupEntry(env, ndDedupKey(hash), { key, size: String(content).length, fileName, updatedAt: Date.now() });
    return jsonResponse({ name: basename(key), key, path: key });
  }

  await env.img_r2.put(key, String(content), {
    httpMetadata: {
      contentType: body.contentType || 'text/plain',
    },
  });

  return jsonResponse({ name: basename(key), key, path: key });
}
