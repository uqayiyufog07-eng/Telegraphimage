import { isEmptyBinding, jsonResponse } from './http.js';

// 所有者（单用户）鉴权：无状态 HMAC 签名 Cookie，不依赖 KV 会话存储。
//
// 密码来源：优先环境变量 OWNER_PASSWORD，回退 BASIC_PASS（兼容既有部署）。
// 两者皆空 → 鉴权关闭（整站公开，向后兼容）。
//
// Cookie 结构：base64url(payload).base64url(hmacSHA256(payload, 密码))
// 改密即吊销全部已签发 Cookie。

export const OWNER_COOKIE = 'wb_owner';
export const OWNER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

// ---------- 密码解析 ----------

export function ownerPasswordSet(env) {
  return !isEmptyBinding(env.OWNER_PASSWORD) || !isEmptyBinding(env.BASIC_PASS);
}

export function resolveOwnerPassword(env) {
  if (!isEmptyBinding(env.OWNER_PASSWORD)) return env.OWNER_PASSWORD;
  if (!isEmptyBinding(env.BASIC_PASS)) return env.BASIC_PASS;
  return '';
}

// ---------- base64url ----------

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- HMAC ----------

async function hmacKey(env) {
  const password = resolveOwnerPassword(env);
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function buildCookieValue(payloadObj, env, key) {
  const payloadJson = JSON.stringify(payloadObj);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  // 关键：hmacKey 是 async，此处由调用方传入已 await 的 key
  return crypto.subtle.sign('HMAC', key, payloadBytes).then(sig => {
    return toBase64Url(payloadBytes) + '.' + toBase64Url(sig);
  });
}

// ---------- Cookie 读写 ----------

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:';
  return (
    OWNER_COOKIE + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge +
    (secure ? '; Secure' : '')
  );
}

// ---------- 对外 API ----------

// 校验当前请求是否已登录（有效签名 Cookie）。鉴权关闭时返回 false（不视为登录态）。
export async function isOwnerLoggedIn(request, env) {
  if (!ownerPasswordSet(env)) return false;
  const raw = readCookie(request, OWNER_COOKIE);
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  let payloadBytes;
  try {
    payloadBytes = fromBase64Url(payloadB64);
  } catch {
    return false;
  }
  let sigBytes;
  try {
    sigBytes = fromBase64Url(sigB64);
  } catch {
    return false;
  }
  try {
    const key = await hmacKey(env);
    return await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
  } catch {
    return false;
  }
}

// 登录成功 Response：写入签名 Cookie。
export async function ownerLoginResponse(request, env, body = { ok: true }) {
  const key = await hmacKey(env);
  const value = await buildCookieValue(
    { ok: true, at: new Date().toISOString() },
    env,
    key
  );
  return jsonResponse(body, {
    headers: {
      'Set-Cookie': cookieHeader(request, value, OWNER_TTL_SECONDS),
      'Cache-Control': 'no-store',
    },
  });
}

// 退出登录 Response：清 Cookie。
export function ownerLogoutResponse(request) {
  return jsonResponse({ ok: true }, {
    headers: {
      'Set-Cookie': cookieHeader(request, '', 0),
      'Cache-Control': 'no-store',
    },
  });
}
