const assert = require('assert');

function authRequest(username, password) {
  const cred = btoa(username + ':' + password);
  return new Request('https://example.com/webdav/', {
    headers: { Authorization: 'Basic ' + cred },
  });
}

function noAuthRequest() {
  return new Request('https://example.com/webdav/');
}

describe('WebDAV 鉴权工具 (webdav-auth.js)', function () {
  it('WEBDAV_USER/PASS 正确时通过', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = { WEBDAV_USER: 'envuser', WEBDAV_PASS: 'envpass' };

    const ok = await authenticateWebDAV(authRequest('envuser', 'envpass'), env);
    assert.strictEqual(ok, null);
  });

  it('WEBDAV_USER/PASS 错误时返回 401', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = { WEBDAV_USER: 'envuser', WEBDAV_PASS: 'envpass' };

    const bad = await authenticateWebDAV(authRequest('envuser', 'wrong'), env);
    assert.ok(bad instanceof Response);
    assert.strictEqual(bad.status, 401);
  });

  it('WEBDAV 凭证不匹配时回退 BASIC_USER/PASS 通过', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = {
      WEBDAV_USER: 'envuser',
      WEBDAV_PASS: 'envpass',
      BASIC_USER: 'admin',
      BASIC_PASS: 'secret',
    };

    const ok = await authenticateWebDAV(authRequest('admin', 'secret'), env);
    assert.strictEqual(ok, null);
  });

  it('仅配置 BASIC_USER/PASS 时正确凭证通过', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = { BASIC_USER: 'admin', BASIC_PASS: 'secret' };

    const ok = await authenticateWebDAV(authRequest('admin', 'secret'), env);
    assert.strictEqual(ok, null);

    const bad = await authenticateWebDAV(authRequest('admin', 'wrong'), env);
    assert.ok(bad instanceof Response);
    assert.strictEqual(bad.status, 401);
  });

  it('未配置任何凭证时公开访问', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = {};

    const result = await authenticateWebDAV(noAuthRequest(), env);
    assert.strictEqual(result, null);
  });

  it('配置了凭证但缺少 Authorization 头时返回 401 challenge', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = { BASIC_USER: 'admin', BASIC_PASS: 'secret' };

    const result = await authenticateWebDAV(noAuthRequest(), env);
    assert.ok(result instanceof Response);
    assert.strictEqual(result.status, 401);
    assert.ok(result.headers.get('WWW-Authenticate'));
  });
});
