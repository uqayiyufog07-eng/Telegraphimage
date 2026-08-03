import { isEmptyBinding } from './http.js';

// 用户系统：账号、密码哈希、会话全部存放在 img_url KV 中。
//
// KV 键位约定：
//   user:<username>        → { username, passHash, salt, iterations, createdAt, lastLoginAt, disabled }
//   sess:<token>           → { username, createdAt }（带 expirationTtl，自动过期）
//   loginfail:<username>   → 失败计数（带 expirationTtl，用于登录限流）
//
// 密码使用 PBKDF2-SHA256（WebCrypto，Workers 原生支持），随机盐，永不存明文。

export const USER_KEY_PREFIX = 'user:';
export const SESSION_KEY_PREFIX = 'sess:';
export const LOGIN_FAIL_PREFIX = 'loginfail:';
export const SESSION_COOKIE = 'wb_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

export const PBKDF2_ITERATIONS = 100000;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_SECONDS = 600; // 连续失败 5 次锁定 10 分钟

// ---------- 可用性 ----------

export function authAvailable(env) {
  return !isEmptyBinding(env.img_url);
}

export function registrationOpen(env) {
  if (!authAvailable(env)) return false;
  const flag = (env.AUTH_REGISTER || '').toLowerCase();
  return flag !== 'false' && flag !== 'off' && flag !== 'closed';
}

// ---------- 校验 ----------

export function validateUsername(username) {
  if (typeof username !== 'string') return '用户名格式不正确';
  if (!USERNAME_PATTERN.test(username)) {
    return '用户名需为 3-32 位字母、数字、下划线或连字符';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `密码至少需要 ${PASSWORD_MIN} 个字符`;
  }
  if (password.length > PASSWORD_MAX) {
    return `密码最长 ${PASSWORD_MAX} 个字符`;
  }
  return null;
}

// ---------- 密码哈希 ----------

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function pbkdf2(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toBase64(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { salt: toBase64(salt), hash, iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password, userRecord) {
  const expected = userRecord && (userRecord.passHash || userRecord.hash);
  if (!expected || !userRecord.salt) return false;
  const iterations = userRecord.iterations || PBKDF2_ITERATIONS;
  const computed = await pbkdf2(password, fromBase64(userRecord.salt), iterations);
  return timingSafeEqual(computed, expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------- 用户 CRUD ----------

export async function getUser(env, username) {
  if (!authAvailable(env)) return null;
  const raw = await env.img_url.get(USER_KEY_PREFIX + username);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function createUser(env, username, password) {
  const { salt, hash, iterations } = await hashPassword(password);
  const record = {
    username,
    passHash: hash,
    salt,
    iterations,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    disabled: false,
  };
  await env.img_url.put(USER_KEY_PREFIX + username, JSON.stringify(record));
  return record;
}

export async function updateUser(env, record) {
  await env.img_url.put(USER_KEY_PREFIX + record.username, JSON.stringify(record));
}

export async function deleteUser(env, username) {
  await env.img_url.delete(USER_KEY_PREFIX + username);
}

export async function listUsers(env, { limit = 200, cursor } = {}) {
  if (!authAvailable(env)) return { users: [], cursor: null, complete: true };
  const result = await env.img_url.list({ prefix: USER_KEY_PREFIX, limit, cursor });
  const users = [];
  for (const key of result.keys) {
    const raw = await env.img_url.get(key.name);
    if (!raw) continue;
    try {
      const u = JSON.parse(raw);
      users.push({
        username: u.username,
        createdAt: u.createdAt || null,
        lastLoginAt: u.lastLoginAt || null,
        disabled: !!u.disabled,
      });
    } catch {
      // 跳过损坏记录
    }
  }
  users.sort((a, b) => a.username.localeCompare(b.username));
  return {
    users,
    cursor: result.list_complete ? null : result.cursor,
    complete: !!result.list_complete,
  };
}

// ---------- 登录限流 ----------

export async function getLoginLock(env, username) {
  if (!authAvailable(env)) return { locked: false, fails: 0 };
  const raw = await env.img_url.get(LOGIN_FAIL_PREFIX + username);
  const fails = raw ? parseInt(raw, 10) || 0 : 0;
  return { locked: fails >= LOGIN_LOCK_THRESHOLD, fails };
}

export async function recordLoginFailure(env, username) {
  if (!authAvailable(env)) return;
  const { fails } = await getLoginLock(env, username);
  await env.img_url.put(LOGIN_FAIL_PREFIX + username, String(fails + 1), {
    expirationTtl: LOGIN_LOCK_SECONDS,
  });
}

export async function clearLoginFailures(env, username) {
  if (!authAvailable(env)) return;
  await env.img_url.delete(LOGIN_FAIL_PREFIX + username);
}

// ---------- 会话 ----------

export async function createSession(env, username) {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await env.img_url.put(
    SESSION_KEY_PREFIX + token,
    JSON.stringify({ username, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

export async function getSessionUser(request, env) {
  if (!authAvailable(env)) return null;
  const token = readSessionToken(request);
  if (!token) return null;
  const raw = await env.img_url.get(SESSION_KEY_PREFIX + token);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    const user = await getUser(env, session.username);
    if (!user || user.disabled) return null;
    return { username: user.username, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, token };
  } catch {
    return null;
  }
}

export async function destroySession(request, env) {
  if (!authAvailable(env)) return;
  const token = readSessionToken(request);
  if (token) {
    await env.img_url.delete(SESSION_KEY_PREFIX + token);
  }
}

// 删除某用户的全部会话（管理员禁用/删除用户时调用）
export async function deleteUserSessions(env, username) {
  if (!authAvailable(env)) return;
  let cursor;
  do {
    const result = await env.img_url.list({ prefix: SESSION_KEY_PREFIX, limit: 1000, cursor });
    for (const key of result.keys) {
      const raw = await env.img_url.get(key.name);
      if (!raw) continue;
      try {
        if (JSON.parse(raw).username === username) {
          await env.img_url.delete(key.name);
        }
      } catch {
        // 跳过损坏记录
      }
    }
    cursor = result.list_complete ? null : result.cursor;
  } while (cursor);
}

export function readSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export function sessionCookieHeader(request, token) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieHeader(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// 展示给前端的安全用户信息（不含任何哈希材料）
export function publicUser(record) {
  if (!record) return null;
  return {
    username: record.username,
    createdAt: record.createdAt || null,
    lastLoginAt: record.lastLoginAt || null,
  };
}
