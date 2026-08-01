import { jsonResponse } from '../../utils/http.js';
import { normalizeFileKey, normalizeDirPrefix, dirname, basename } from '../../utils/r2-paths.js';

// 上传文件：POST /netdisk/api/upload?path=docs/sub
// 使用 multipart/form-data，文件字段名为 "file"（可多文件）。
// 也可通过 JSON { path, content } 上传文本文件。
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

    await env.img_r2.put(key, file.stream ? file.stream() : await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
      },
    });

    results.push({
      name: basename(key),
      key,
      size: file.size,
      path: key,
    });
  }

  return jsonResponse({ uploaded: results, count: results.length });
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
  await env.img_r2.put(key, String(content), {
    httpMetadata: {
      contentType: body.contentType || 'text/plain',
    },
  });

  return jsonResponse({ name: basename(key), key, path: key });
}
