import { normalizeFileKey, normalizeDirPrefix, isFolderKey, listAllObjects, basename } from '../../utils/r2-paths.js';
import { Zip } from 'fflate';

// 下载文件或文件夹 ZIP：
//   GET /netdisk/api/download?path=docs/file.txt          -> 单文件下载
//   GET /netdisk/api/download?path=docs/folder&zip=true    -> 文件夹 ZIP 打包下载
//   GET /netdisk/api/download?path=docs/folder/            -> 文件夹 ZIP 打包下载
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rawPath = url.searchParams.get('path') || '';
  const wantZip = url.searchParams.get('zip') === 'true' || rawPath.endsWith('/');

  const fileKey = normalizeFileKey(rawPath);
  const dirPrefix = normalizeDirPrefix(rawPath);

  if (!rawPath) {
    return new Response(JSON.stringify({ error: 'Missing "path" parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 尝试作为文件下载
  if (!wantZip) {
    const head = await env.img_r2.head(fileKey);
    if (head && !isFolderKey(fileKey)) {
      return await streamSingleFile(env, fileKey, head, request);
    }
  }

  // 文件夹 ZIP 打包
  const children = await listAllObjects(env.img_r2, dirPrefix, 5000);
  // 过滤掉文件夹标记对象
  const fileObjects = children.filter(o => !isFolderKey(o.key));

  if (fileObjects.length === 0 && !wantZip) {
    return new Response(JSON.stringify({ error: 'File not found', path: rawPath }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return await streamFolderZip(env, dirPrefix, fileObjects, rawPath);
}

async function streamSingleFile(env, key, headInfo, request) {
  const obj = await env.img_r2.get(key, { onlyIf: request.headers });
  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  if (typeof obj.writeHttpMetadata === 'function') {
    obj.writeHttpMetadata(headers);
  }
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  const fileName = basename(key) || 'download';
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  headers.set('Content-Length', String(obj.size));

  return new Response(obj.body, { status: 200, headers });
}

async function streamFolderZip(env, dirPrefix, fileObjects, rawPath) {
  const zipName = (basename(rawPath.replace(/\/+$/, '')) || 'download') + '.zip';

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const zip = new Zip();

  zip.ondata = (err, data, final) => {
    if (err) {
      writer.abort(err);
      return;
    }
    writer.write(data);
    if (final) {
      writer.close();
    }
  };

  // 异步写入 ZIP 内容
  (async () => {
    try {
      for (const obj of fileObjects) {
        // ZIP 内的相对路径：去掉 dirPrefix
        let entryName = obj.key;
        if (dirPrefix && entryName.startsWith(dirPrefix)) {
          entryName = entryName.slice(dirPrefix.length);
        }
        if (!entryName) continue;

        const file = await env.img_r2.get(obj.key);
        if (!file) continue;

        const zipFile = {
          name: entryName,
          size: obj.size,
          level: 0, // 不压缩以节省 CPU（Workers CPU 限制），仅打包
          mtime: obj.uploaded ? obj.uploaded.getTime() / 1000 : Date.now() / 1000,
        };

        // fflate Zip.add 需要数据为 Uint8Array。对大文件需分块读取。
        // Workers 内存限制 128MB，这里限制单文件 100MB 以内参与打包。
        if (obj.size > 100 * 1024 * 1024) {
          // 跳过过大文件，写入一个占位说明
          const placeholder = new TextEncoder().encode(`[文件过大，未打包: ${entryName}]\n`);
          zip.add({ ...zipFile, name: entryName + '.SKIPPED.txt', size: placeholder.length }, placeholder);
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        zip.add(zipFile, data);
      }
      zip.end();
    } catch (err) {
      console.error('ZIP stream error:', err);
      try { writer.abort(err); } catch {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    },
  });
}
