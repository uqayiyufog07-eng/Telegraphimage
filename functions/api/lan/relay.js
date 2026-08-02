// /api/lan/relay — 局域网 HTTP 中继
//
// 用途：localsend.html 的 LocalSend 协议客户端需要访问局域网设备
// (http://192.168.x.x:53317/...)，但浏览器受 CORS 与混合内容限制无法
// 直接完成请求。经本站中继后，浏览器只与同源通信，由本端转发到目标设备。
//
// 适用场景：本站部署在用户的局域网内（如 wrangler pages dev / 内网服务器）。
// 部署在 Cloudflare 公网时，私有地址不可达，目标连接会失败并返回 502，
// 前端会据此提示用户改用内网部署或「快传」。
//
// 安全约束：
//  - 仅允许转发到私有 IPv4 段 / localhost / *.local 主机名（防开放代理滥用）
//  - 禁止 169.254.0.0/16（云厂商元数据地址）与 URL 内嵌凭据
//  - 仅 http/https 协议

const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const LOCAL_HOST = /^(localhost|[a-z0-9][a-z0-9\-]{0,62}(\.[a-z0-9][a-z0-9\-]{0,62})*\.local)$/i;

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Lan-Relay': '1' },
  });
}

function validateTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return { error: '目标地址无法解析' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: '仅支持 http/https 协议' };
  }
  if (url.username || url.password) {
    return { error: '目标地址不允许携带凭据' };
  }
  const host = url.hostname;
  // URL 解析后 IPv6 会带方括号，一律拒绝（功能上局域网设备用 IPv4 即可）
  if (host.includes('[') || host.includes(':') || host.includes('%')) {
    return { error: '不支持的主机格式' };
  }
  if (/^169\.254\./.test(host) || host === '0.0.0.0') {
    return { error: '禁止访问该地址段' };
  }
  if (!PRIVATE_IPV4.test(host) && !LOCAL_HOST.test(host)) {
    return { error: '仅允许局域网私有地址（10/8、172.16/12、192.168/16、localhost、*.local）' };
  }
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
  if (!(port >= 1 && port <= 65535)) {
    return { error: '端口无效' };
  }
  return { url: url.toString() };
}

async function handle(context) {
  const { request } = context;

  const rawTarget = request.headers.get('X-Lan-Target');
  if (!rawTarget) return jsonError('缺少 X-Lan-Target 头', 400);

  const check = validateTarget(rawTarget);
  if (check.error) return jsonError(check.error, 400);

  const method = (request.headers.get('X-Lan-Method') || request.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const headers = {};
  const ct = request.headers.get('Content-Type');
  if (hasBody && ct) headers['Content-Type'] = ct;

  const init = {
    method,
    headers,
    redirect: 'manual',
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream;
  try {
    upstream = await fetch(check.url, init);
  } catch (e) {
    return jsonError('target_unreachable', 502);
  }

  // 透传目标状态码与响应体（流式），标记中继来源
  const respHeaders = new Headers();
  respHeaders.set('X-Lan-Relay', '1');
  respHeaders.set('X-Lan-Status', String(upstream.status));
  respHeaders.set('Cache-Control', 'no-store');
  const upCt = upstream.headers.get('Content-Type');
  if (upCt) respHeaders.set('Content-Type', upCt);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestPut = handle;
