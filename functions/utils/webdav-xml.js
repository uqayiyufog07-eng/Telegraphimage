// WebDAV XML 工具：生成 multistatus 响应、解析 PROPFIND 请求。
// WebDAV 协议使用 XML 交换数据，这里实现一个最小可用集。

// HTML 转义（XML 共用）
function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 格式化 Date 为 HTTP 日期（RFC 7231 IMF-fixdate），如 "Tue, 15 Nov 1994 12:45:26 GMT"
export function toHttpDate(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  return date.toUTCString();
}

// ISO 8601（WebDAV getlastmodified 也常用 ISO，但标准建议 RFC 1123）
export function toIsoDate(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  return date.toISOString();
}

// 生成单个 <response> 元素
// entry: { href: string, isCollection: boolean, size: number, lastModified: Date|string, etag?: string, contentType?: string }
export function renderPropstatResponse(entry, baseUrl) {
  const href = escapeXml(entry.href);
  const isCollection = !!entry.isCollection;
  const size = Number(entry.size || 0);
  const lastMod = entry.lastModified ? toHttpDate(entry.lastModified) : '';

  const propParts = [
    `      <D:resourcetype>${isCollection ? '<D:collection/>' : ''}</D:resourcetype>`,
    `      <D:getcontentlength>${size}</D:getcontentlength>`,
    `      <D:getlastmodified>${escapeXml(lastMod)}</D:getlastmodified>`,
  ];
  if (entry.etag) {
    propParts.push(`      <D:getetag>"${escapeXml(entry.etag)}"</D:getetag>`);
  }
  if (entry.contentType) {
    propParts.push(`      <D:getcontenttype>${escapeXml(entry.contentType)}</D:getcontenttype>`);
  }

  return [
    `  <D:response>`,
    `    <D:href>${href}</D:href>`,
    `    <D:propstat>`,
    `      <D:prop>`,
    ...propParts,
    `      </D:prop>`,
    `      <D:status>HTTP/1.1 200 OK</D:status>`,
    `    </D:propstat>`,
    `  </D:response>`,
  ].join('\n');
}

// 生成完整的 multistatus 响应体
// entries: Array<entry>
export function renderMultistatus(entries) {
  const responses = entries.map(e => renderPropstatResponse(e)).join('\n');
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<D:multistatus xmlns:D="DAV:">`,
    responses,
    `</D:multistatus>`,
  ].join('\n');
}

// multistatus 响应（带 207 状态码）
export function multistatusResponse(entries) {
  const body = renderMultistatus(entries);
  return new Response(body, {
    status: 207,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'DAV': '1, 2',
    },
  });
}

// OPTIONS 响应：宣告支持的 WebDAV 方法
export function webdavOptionsResponse() {
  return new Response(null, {
    status: 200,
    headers: {
      'DAV': '1, 2',
      'Allow': 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY',
      'MS-Author-Via': 'DAV',
    },
  });
}

// 解析 PROPFIND 请求 body，返回请求的属性名集合。
// 空 body 表示请求所有属性（allprop）。
// 返回: 'allprop' | 'propname' | Set<string>
export function parsePropfind(body) {
  if (!body || body.trim() === '') return 'allprop';
  const text = String(body);
  if (text.includes('<propname')) return 'propname';
  if (text.includes('<allprop') || !text.includes('<prop')) return 'allprop';

  const props = new Set();
  const propRegex = /<([a-zA-Z0-9]+):?(\w+)[^>]*>/g;
  // 简化解析：提取 <prop> 块内的子元素
  const propBlockMatch = text.match(/<[^:]*:prop[^>]*>([\s\S]*?)<\/[^:]*:prop>/);
  if (propBlockMatch) {
    const inner = propBlockMatch[1];
    let m;
    while ((m = propRegex.exec(inner)) !== null) {
      props.add(m[2] || m[1]);
    }
  }
  return props.size > 0 ? props : 'allprop';
}

// 从 URL 路径中提取 WebDAV 资源路径（去掉 /webdav 前缀，保留剩余部分）。
//   webdavPathFromUrl("/webdav/docs/file.txt", "/webdav") => "docs/file.txt"
//   webdavPathFromUrl("/webdav/", "/webdav")              => ""
export function webdavPathFromUrl(pathname, mountPrefix) {
  let p = String(pathname || '');
  // 去掉 mount 前缀
  if (mountPrefix && p.startsWith(mountPrefix)) {
    p = p.slice(mountPrefix.length);
  }
  // 去掉开头 /
  p = p.replace(/^\/+/, '');
  return decodeURIComponent(p);
}

// 构造 WebDAV href（需以 / 开头，编码特殊字符）
export function buildWebdavHref(mountPrefix, resourcePath, isCollection) {
  let p = String(resourcePath || '');
  if (p && !p.startsWith('/')) p = '/' + p;
  // 编码路径段
  const encoded = p.split('/').map(seg => seg ? encodeURIComponent(seg) : '').join('/');
  let href = mountPrefix.replace(/\/+$/, '') + encoded;
  if (isCollection && !href.endsWith('/')) href += '/';
  return href;
}
