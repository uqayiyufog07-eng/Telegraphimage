import { basicAuthentication, unauthorizedResponse } from './auth.js';
import { isEmptyBinding } from './http.js';

export const WEBDAV_AUTH_CHALLENGE = 'Basic realm="WebDAV", charset="UTF-8"';

// WebDAV 鉴权（单所有者模式）：仅使用环境变量凭证。
// 优先 WEBDAV_USER/WEBDAV_PASS，回退 BASIC_USER/BASIC_PASS。
// 全部未配置时公开访问（向后兼容）。
// 返回 null 表示通过；返回 Response 表示鉴权失败（401）。
export async function authenticateWebDAV(request, env) {
  const hasWebdavUser = !isEmptyBinding(env.WEBDAV_USER);
  const hasWebdavPass = !isEmptyBinding(env.WEBDAV_PASS);
  const hasBasicUser = !isEmptyBinding(env.BASIC_USER);
  const hasBasicPass = !isEmptyBinding(env.BASIC_PASS);

  // 若 env 有凭证，则需要鉴权；否则公开访问
  if (!hasWebdavUser && !hasWebdavPass && !hasBasicUser && !hasBasicPass) {
    return null;
  }

  if (!request.headers.has('Authorization')) {
    return webdavChallenge(env);
  }

  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) {
    return credentials;
  }

  // 1. 优先 WEBDAV_USER/WEBDAV_PASS
  if (hasWebdavUser && hasWebdavPass) {
    if (env.WEBDAV_USER === credentials.user && env.WEBDAV_PASS === credentials.pass) {
      return null;
    }
    // 2. 若 BASIC 也配置了则尝试 BASIC
    if (hasBasicUser && hasBasicPass) {
      if (env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass) {
        return null;
      }
    }
    return unauthorizedResponse('Invalid WebDAV credentials.');
  }

  // 3. 仅 BASIC 凭证
  if (hasBasicUser && hasBasicPass) {
    if (env.BASIC_USER !== credentials.user || env.BASIC_PASS !== credentials.pass) {
      return unauthorizedResponse('Invalid credentials.');
    }
    return null;
  }

  // 4. 有部分凭证配置但不完整
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
