import { basicAuthentication, basicAuthChallengeResponse, unauthorizedResponse } from './auth.js';
import { isEmptyBinding } from './http.js';

export const WEBDAV_AUTH_CHALLENGE = 'Basic realm="WebDAV", charset="UTF-8"';

// WebDAV 鉴权：优先使用 WEBDAV_USER/WEBDAV_PASS，未设置时回退 BASIC_USER/BASIC_PASS。
// 返回 null 表示通过；返回 Response 表示鉴权失败（401）。
export function authenticateWebDAV(request, env) {
  const hasWebdavUser = !isEmptyBinding(env.WEBDAV_USER);
  const hasWebdavPass = !isEmptyBinding(env.WEBDAV_PASS);
  const hasBasicUser = !isEmptyBinding(env.BASIC_USER);
  const hasBasicPass = !isEmptyBinding(env.BASIC_PASS);

  // 若两套凭证都没配置，则公开访问（与网盘 API 行为一致）
  if (!hasWebdavUser && !hasWebdavPass && !hasBasicUser && !hasBasicPass) {
    return null;
  }

  // WebDAV 凭证必须成对
  if (hasWebdavUser !== hasWebdavPass) {
    return new Response('WEBDAV_USER and WEBDAV_PASS must both be configured', { status: 500 });
  }
  // BASIC 凭证必须成对（回退场景）
  if (hasBasicUser !== hasBasicPass) {
    return new Response('BASIC_USER and BASIC_PASS must both be configured', { status: 500 });
  }

  if (!request.headers.has('Authorization')) {
    return webdavChallenge(env);
  }

  const credentials = basicAuthentication(request);
  if (credentials instanceof Response) {
    return credentials;
  }

  // 优先校验 WebDAV 凭证
  if (hasWebdavUser && hasWebdavPass) {
    if (env.WEBDAV_USER === credentials.user && env.WEBDAV_PASS === credentials.pass) {
      return null;
    }
    // WebDAV 凭证不匹配，若 BASIC 也配置了则尝试 BASIC（允许两套账号都能用）
    if (hasBasicUser && hasBasicPass) {
      if (env.BASIC_USER === credentials.user && env.BASIC_PASS === credentials.pass) {
        return null;
      }
    }
    return unauthorizedResponse('Invalid WebDAV credentials.');
  }

  // 仅 BASIC 凭证
  if (env.BASIC_USER !== credentials.user || env.BASIC_PASS !== credentials.pass) {
    return unauthorizedResponse('Invalid credentials.');
  }

  return null;
}

function webdavChallenge(env) {
  // 复用 BASIC 挑战格式，realm 区分 WebDAV
  const realm = (hasWebdavCreds(env) ? 'WebDAV' : 'my scope');
  return new Response('You need to login.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  });
}

function hasWebdavCreds(env) {
  return !isEmptyBinding(env.WEBDAV_USER) && !isEmptyBinding(env.WEBDAV_PASS);
}
