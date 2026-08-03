import { basicAuthentication, basicAuthChallengeResponse, unauthorizedResponse } from './auth.js';
import { isEmptyBinding } from './http.js';
import { hashPassword, verifyPassword } from './users.js';

export const WEBDAV_AUTH_CHALLENGE = 'Basic realm="WebDAV", charset="UTF-8"';
export const WEBDAV_USER_KEY_PREFIX = 'webdav:user:';

// WebDAV 鉴权：优先使用 KV 中的动态账号，回退 WEBDAV_USER/WEBDAV_PASS，再回退 BASIC_USER/BASIC_PASS。
// 返回 null 表示通过；返回 Response 表示鉴权失败（401）。
export async function authenticateWebDAV(request, env) {
  const hasWebdavUser = !isEmptyBinding(env.WEBDAV_USER);
  const hasWebdavPass = !isEmptyBinding(env.WEBDAV_PASS);
  const hasBasicUser = !isEmptyBinding(env.BASIC_USER);
  const hasBasicPass = !isEmptyBinding(env.BASIC_PASS);
  const hasKvAccounts = await hasAnyWebDAVAccount(env);

  // 若 KV 有账号或 env 有凭证，则需要鉴权；否则公开访问
  if (!hasKvAccounts && !hasWebdavUser && !hasWebdavPass && !hasBasicUser && !hasBasicPass) {
    return null;
  }

  if (!request.headers.has('Authorization')) {
    return webdavChallenge(env);
  }

  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) {
    return credentials;
  }

  // 1. 优先校验 KV 动态账号
  if (hasKvAccounts) {
    const account = await getWebDAVAccount(env, credentials.user);
    if (account && !account.disabled) {
      const ok = await verifyPassword(credentials.pass, account);
      if (ok) return null;
    }
  }

  // 2. 回退 WebDAV_USER/WEBDAV_PASS
  if (hasWebdavUser && hasWebdavPass) {
    if (env.WEBDAV_USER === credentials.user && env.WEBDAV_PASS === credentials.pass) {
      return null;
    }
    // 3. 若 BASIC 也配置了则尝试 BASIC
    if (hasBasicUser && hasBasicPass) {
      if (env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass) {
        return null;
      }
    }
    return unauthorizedResponse('Invalid WebDAV credentials.');
  }

  // 4. 仅 BASIC 凭证
  if (hasBasicUser && hasBasicPass) {
    if (env.BASIC_USER !== credentials.user || env.BASIC_PASS !== credentials.pass) {
      return unauthorizedResponse('Invalid credentials.');
    }
    return null;
  }

  // 5. 仅有 KV 账号但未匹配
  return unauthorizedResponse('Invalid WebDAV credentials.');
}

function webdavChallenge(env) {
  const realm = hasWebdavCreds(env) ? 'WebDAV' : 'my scope';
  return new Response('You need to login.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="' + realm + '", charset="UTF-8"',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  });
}

function hasWebdavCreds(env) {
  return !isEmptyBinding(env.WEBDAV_USER) && !isEmptyBinding(env.WEBDAV_PASS);
}

// ---------- KV 动态账号管理 ----------

export async function hasAnyWebDAVAccount(env) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) return false;
  const result = await env.img_url.list({ prefix: WEBDAV_USER_KEY_PREFIX, limit: 1 });
  return result.keys.length > 0;
}

export async function getWebDAVAccount(env, username) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) return null;
  if (!username) return null;
  const raw = await env.img_url.get(WEBDAV_USER_KEY_PREFIX + username);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listWebDAVAccounts(env) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) return [];
  const result = await env.img_url.list({ prefix: WEBDAV_USER_KEY_PREFIX, limit: 1000 });
  const accounts = [];
  for (const key of result.keys) {
    const raw = await env.img_url.get(key.name);
    if (!raw) continue;
    try {
      const a = JSON.parse(raw);
      accounts.push({
        username: a.username,
        createdAt: a.createdAt || null,
        disabled: !!a.disabled,
      });
    } catch {
      // 跳过损坏记录
    }
  }
  accounts.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  return accounts;
}

export async function createWebDAVAccount(env, username, password) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) {
    throw new Error('KV 未绑定，无法管理 WebDAV 账号');
  }
  if (!username || typeof username !== 'string') {
    throw new Error('用户名不能为空');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('密码至少需要 6 个字符');
  }
  const existing = await getWebDAVAccount(env, username);
  if (existing) {
    throw new Error('该用户名已存在');
  }
  const { salt, hash, iterations } = await hashPassword(password);
  const record = {
    username,
    passHash: hash,
    salt,
    iterations,
    createdAt: new Date().toISOString(),
    disabled: false,
  };
  await env.img_url.put(WEBDAV_USER_KEY_PREFIX + username, JSON.stringify(record));
  return { username, createdAt: record.createdAt, disabled: false };
}

export async function resetWebDAVAccount(env, username, password) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) {
    throw new Error('KV 未绑定，无法管理 WebDAV 账号');
  }
  const account = await getWebDAVAccount(env, username);
  if (!account) {
    throw new Error('账号不存在');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('密码至少需要 6 个字符');
  }
  const { salt, hash, iterations } = await hashPassword(password);
  account.passHash = hash;
  account.salt = salt;
  account.iterations = iterations;
  await env.img_url.put(WEBDAV_USER_KEY_PREFIX + username, JSON.stringify(account));
  return { username, createdAt: account.createdAt, disabled: !!account.disabled };
}

export async function deleteWebDAVAccount(env, username) {
  if (!env || !env.img_url || isEmptyBinding(env.img_url)) return false;
  if (!username) return false;
  await env.img_url.delete(WEBDAV_USER_KEY_PREFIX + username);
  return true;
}

export async function disableWebDAVAccount(env, username) {
  const account = await getWebDAVAccount(env, username);
  if (!account) return false;
  account.disabled = true;
  await env.img_url.put(WEBDAV_USER_KEY_PREFIX + username, JSON.stringify(account));
  return true;
}

export async function enableWebDAVAccount(env, username) {
  const account = await getWebDAVAccount(env, username);
  if (!account) return false;
  account.disabled = false;
  await env.img_url.put(WEBDAV_USER_KEY_PREFIX + username, JSON.stringify(account));
  return true;
}
