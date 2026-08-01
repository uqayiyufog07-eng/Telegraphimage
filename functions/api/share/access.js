import { jsonResponse } from '../../utils/http.js';
import { isFolderKey, listAllObjects, basename, normalizePath } from '../../utils/r2-paths.js';
import {
  getShare,
  verifyPassword,
  isExpired,
  incrementDownloadCount,
} from '../../utils/share-token.js';
import { Zip } from 'fflate';

// 公开分享访问接口（无需 BASIC 鉴权，路径 /api/share/access）：
//   GET  /api/share/access?token=xxx[&password=xxx]
//        返回分享信息 + （文件夹）目录列表
//   POST /api/share/access?token=xxx  Body: { password: "xxx" }
//        校验密码，返回分享信息
//   GET  /api/share/access?token=xxx&password=xxx&download=file.txt
//        下载分享中的单个文件
//   GET  /api/share/access?token=xxx&password=xxx&zip=true
//        下载分享文件夹 ZIP

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const password = url.searchParams.get('password') || '';
  const downloadFile = url.searchParams.get('download');
  const wantZip = url.searchParams.get('zip') === 'true';

  if (!token) {
    return jsonResponse({ error: 'Missing "token" parameter' }, { status: 400 });
  }

  const meta = await getShare(env, token);
  if (!meta) {
    return jsonResponse({ error: 'Share not found', token }, { status: 404 });
  }

  if (isExpired(meta.expiresAt)) {
    return jsonResponse({ error: 'Share has expired', token }, { status: 410 });
  }

  // 校验密码
  const ok = await verifyPassword(password, meta.passwordHash);
  if (!ok) {
    return jsonResponse({ error: 'Password required or incorrect', needsPassword: !!meta.passwordHash }, { status: 401 });
  }

  // 下载单文件
  if (downloadFile) {
    return await downloadSharedFile(env, token, meta, downloadFile);
  }

  // 下载文件夹 ZIP
  if (wantZip && meta.type === 'folder') {
    await incrementDownloadCount(env, token);
    return await downloadSharedFolderZip(env, meta);
  }

  // 返回分享信息
  if (meta.type === 'folder') {
    // 支持 dir 参数浏览子目录（相对分享根目录，已剥离 .. 防越界）
    const relRaw = url.searchParams.get('dir') || '';
    const relDir = relRaw ? normalizePath(relRaw) + '/' : '';
    const prefix = meta.path + relDir;

    const result = await env.img_r2.list({
      prefix,
      delimiter: '/',
      limit: 1000,
      include: ['httpMetadata'],
    });

    const directories = (result.delimitedPrefixes || [])
      .map(p => p.slice(prefix.length).replace(/\/+$/, ''))
      .filter(Boolean);

    const items = (result.objects || [])
      .filter(o => !isFolderKey(o.key))
      .map(obj => ({
        name: obj.key.slice(prefix.length),
        path: obj.key,
        size: obj.size,
        modified: obj.uploaded ? obj.uploaded.toISOString() : null,
        contentType: obj.httpMetadata?.contentType || '',
      }));

    directories.sort((a, b) => a.localeCompare(b, 'zh'));
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    return jsonResponse({
      token,
      type: 'folder',
      path: meta.path,
      dir: relDir,
      directories,
      items,
      truncated: result.truncated,
      downloadCount: meta.downloadCount || 0,
    });
  }

  // 单文件分享：返回元信息
  const head = await env.img_r2.head(meta.path);
  return jsonResponse({
    token,
    type: 'file',
    path: meta.path,
    name: basename(meta.path),
    size: head ? head.size : 0,
    contentType: head?.httpMetadata?.contentType || '',
    downloadCount: meta.downloadCount || 0,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return jsonResponse({ error: 'Missing "token" parameter' }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // 空 body 也允许
  }

  const meta = await getShare(env, token);
  if (!meta) {
    return jsonResponse({ error: 'Share not found', token }, { status: 404 });
  }

  if (isExpired(meta.expiresAt)) {
    return jsonResponse({ error: 'Share has expired', token }, { status: 410 });
  }

  const ok = await verifyPassword(body.password || '', meta.passwordHash);
  if (!ok) {
    return jsonResponse({ error: 'Password required or incorrect', needsPassword: !!meta.passwordHash }, { status: 401 });
  }

  return jsonResponse({
    success: true,
    token,
    type: meta.type,
    path: meta.path,
    hasPassword: !!meta.passwordHash,
    expiresAt: meta.expiresAt,
  });
}

// 可预览的文件扩展名 → Content-Type 映射（与 file/[id].js 保持一致）
const PREVIEWABLE_EXTS = {
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', apng: 'image/apng', bmp: 'image/bmp',
  ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
  // videos
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime',
  webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska',
  ts: 'video/mp2t', '3gp': 'video/3gpp',
  // audio
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg',
  wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  opus: 'audio/ogg', wma: 'audio/x-ms-wma',
  // documents
  pdf: 'application/pdf',
  // text / code
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  html: 'text/html', htm: 'text/html', xml: 'application/xml',
  csv: 'text/csv', log: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml',
  toml: 'application/toml', ini: 'text/plain', conf: 'text/plain',
  py: 'text/x-python', java: 'text/x-java-source', c: 'text/x-c',
  cpp: 'text/x-c++', cc: 'text/x-c++', h: 'text/x-c', hpp: 'text/x-c++',
  go: 'text/x-go', rs: 'text/rust', sh: 'application/x-sh',
  bash: 'application/x-sh', zsh: 'application/x-sh',
  sql: 'application/sql', graphql: 'application/graphql',
  dockerfile: 'text/plain', makefile: 'text/plain',
};

function extOf(name) {
  return String(name).split('.').pop().toLowerCase();
}

function isPreviewable(name) {
  return extOf(name) in PREVIEWABLE_EXTS;
}

async function downloadSharedFile(env, token, meta, relativePath) {
  // 安全：relativePath 不能包含 .. 且必须在 meta.path 之下
  const safeRelative = String(relativePath).replace(/\.\./g, '').replace(/^\/+/, '');
  let fullKey;
  if (meta.type === 'folder') {
    fullKey = meta.path + safeRelative;
  } else {
    fullKey = meta.path;
  }

  const obj = await env.img_r2.get(fullKey);
  if (!obj) {
    return new Response('File not found in share', { status: 404 });
  }

  await incrementDownloadCount(env, token);

  const fileName = basename(fullKey);
  const ext = extOf(fileName);
  const headers = new Headers();
  if (typeof obj.writeHttpMetadata === 'function') obj.writeHttpMetadata(headers);

  // 修正 Content-Type：R2 存储时可能为 octet-stream，按扩展名修正
  const upstreamType = headers.get('Content-Type') || '';
  if (!upstreamType || upstreamType.startsWith('application/octet-stream')) {
    const corrected = PREVIEWABLE_EXTS[ext];
    if (corrected) headers.set('Content-Type', corrected);
  }

  // 可预览文件用 inline（浏览器内联显示），其他用 attachment（触发下载）
  const disposition = isPreviewable(fileName) ? 'inline' : 'attachment';
  headers.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`);

  return new Response(obj.body, { status: 200, headers });
}

async function downloadSharedFolderZip(env, meta) {
  const children = await listAllObjects(env.img_r2, meta.path, 5000);
  const fileObjects = children.filter(o => !isFolderKey(o.key));

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const zip = new Zip();
  zip.ondata = (err, data, final) => {
    if (err) { writer.abort(err); return; }
    writer.write(data);
    if (final) writer.close();
  };

  (async () => {
    try {
      for (const obj of fileObjects) {
        let entryName = obj.key;
        if (meta.path && entryName.startsWith(meta.path)) {
          entryName = entryName.slice(meta.path.length);
        }
        if (!entryName) continue;

        if (obj.size > 100 * 1024 * 1024) {
          const placeholder = new TextEncoder().encode(`[文件过大，未打包: ${entryName}]\n`);
          zip.add({ name: entryName + '.SKIPPED.txt', size: placeholder.length, level: 0 }, placeholder);
          continue;
        }

        const file = await env.img_r2.get(obj.key);
        if (!file) continue;
        const data = new Uint8Array(await file.arrayBuffer());
        zip.add({ name: entryName, size: obj.size, level: 0, mtime: obj.uploaded ? obj.uploaded.getTime() / 1000 : Date.now() / 1000 }, data);
      }
      zip.end();
    } catch (err) {
      console.error('share ZIP error:', err);
      try { writer.abort(err); } catch {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('share.zip')}`,
    },
  });
}
