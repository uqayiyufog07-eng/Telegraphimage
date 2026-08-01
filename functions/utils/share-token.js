import { isEmptyBinding } from './http.js';

// 分享 token 工具：生成随机 token、密码 hash、有效期计算。
// 分享元数据存储在 KV key "share:{token}" 的 metadata 中。

const SHARE_KEY_PREFIX = 'share:';
const TOKEN_LENGTH = 12;
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function isShareKey(name) {
  return typeof name === 'string' && name.startsWith(SHARE_KEY_PREFIX);
}

export function shareKey(token) {
  return SHARE_KEY_PREFIX + token;
}

export function tokenFromKey(key) {
  return typeof key === 'string' && key.startsWith(SHARE_KEY_PREFIX)
    ? key.slice(SHARE_KEY_PREFIX.length)
    : null;
}

// 生成随机 token
export function generateToken(length = TOKEN_LENGTH) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let token = '';
  for (const byte of bytes) {
    token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  }
  return token;
}

// SHA-256 hash，返回 hex 字符串。空密码返回空字符串。
export async function hashPassword(password) {
  if (!password) return '';
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// 校验密码：明文 password 与存储的 hash 比对
export async function verifyPassword(password, hash) {
  if (!hash) return true; // 无密码分享
  if (!password) return false;
  const computed = await hashPassword(password);
  return timingSafeEqual(computed, hash);
}

// 简单的常量时间比较
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// 有效期解析：将 "1d"/"7d"/"30d"/"permanent"/数字(秒) 转换为 Unix 时间戳。
// 0 表示永不过期。
export function parseExpiry(raw) {
  if (raw == null || raw === '' || raw === 'permanent' || raw === '0') return 0;
  const str = String(raw).trim().toLowerCase();
  const match = str.match(/^(\d+)\s*(d|h|w|m|y)?$/);
  if (!match) {
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(Date.now() / 1000) + Math.floor(num);
    }
    return 0;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Math.floor(Date.now() / 1000);
  switch (unit) {
    case 'h': return now + value * 3600;
    case 'd': return now + value * 86400;
    case 'w': return now + value * 604800;
    case 'm': return now + value * 2592000; // 30天
    case 'y': return now + value * 31536000;
    default:  return now + value * 86400;   // 默认天
  }
}

// 检查分享是否过期
export function isExpired(expiresAt) {
  if (!expiresAt || expiresAt === 0) return false;
  return Math.floor(Date.now() / 1000) >= expiresAt;
}

// 创建分享元数据对象
export function createShareMetadata({ path, type, password, expiresAt }) {
  return {
    path: String(path || ''),
    type: type === 'folder' ? 'folder' : 'file',
    passwordHash: password || '',  // 应为已 hash 的值
    expiresAt: Number(expiresAt) || 0,
    createdAt: Math.floor(Date.now() / 1000),
    downloadCount: 0,
  };
}

// 保存分享到 KV
export async function putShare(env, token, metadata) {
  await env.img_url.put(shareKey(token), '', { metadata });
}

// 读取分享
export async function getShare(env, token) {
  const record = await env.img_url.getWithMetadata(shareKey(token));
  return record?.metadata || null;
}

// 删除分享
export async function deleteShare(env, token) {
  await env.img_url.delete(shareKey(token));
}

// 增加下载计数（best-effort，失败不阻塞）
export async function incrementDownloadCount(env, token) {
  try {
    const meta = await getShare(env, token);
    if (meta) {
      meta.downloadCount = (meta.downloadCount || 0) + 1;
      await putShare(env, token, meta);
    }
  } catch (e) {
    console.error('incrementDownloadCount failed:', e.message);
  }
}
