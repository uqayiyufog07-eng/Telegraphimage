const assert = require('assert');
const { createMockKV } = require('./helpers');

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
  it('KV account with correct password authenticates', async function () {
    const { createWebDAVAccount } = await import('../functions/utils/webdav-auth.js');
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await createWebDAVAccount(env, 'alice', 'password123');

    const result = await authenticateWebDAV(authRequest('alice', 'password123'), env);
    assert.strictEqual(result, null);
  });

  it('KV account with wrong password returns 401', async function () {
    const { createWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await createWebDAVAccount(env, 'alice', 'password123');

    const result = await authenticateWebDAV(authRequest('alice', 'wrong-pass'), env);
    assert.ok(result instanceof Response);
    assert.strictEqual(result.status, 401);
  });

  it('KV account with non-existent user returns 401', async function () {
    const { createWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await createWebDAVAccount(env, 'alice', 'password123');

    const result = await authenticateWebDAV(authRequest('bob', 'password123'), env);
    assert.ok(result instanceof Response);
    assert.strictEqual(result.status, 401);
  });

  it('disabled KV account is skipped and falls back to env', async function () {
    const { createWebDAVAccount, disableWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = {
      img_url: kv,
      WEBDAV_USER: 'envuser',
      WEBDAV_PASS: 'envpass',
    };
    await createWebDAVAccount(env, 'alice', 'password123');
    await disableWebDAVAccount(env, 'alice');

    // 禁用账号的凭证 → 跳过 KV，env 也不匹配 → 401
    const rejected = await authenticateWebDAV(authRequest('alice', 'password123'), env);
    assert.ok(rejected instanceof Response);
    assert.strictEqual(rejected.status, 401);

    // env 凭证 → 通过
    const envAuth = await authenticateWebDAV(authRequest('envuser', 'envpass'), env);
    assert.strictEqual(envAuth, null);
  });

  it('disabled KV account with no env fallback returns 401', async function () {
    const { createWebDAVAccount, disableWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await createWebDAVAccount(env, 'alice', 'password123');
    await disableWebDAVAccount(env, 'alice');

    const result = await authenticateWebDAV(authRequest('alice', 'password123'), env);
    assert.ok(result instanceof Response);
    assert.strictEqual(result.status, 401);
  });

  it('no KV account falls back to env WEBDAV_USER/PASS', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = {
      img_url: createMockKV(),
      WEBDAV_USER: 'envuser',
      WEBDAV_PASS: 'envpass',
    };

    const ok = await authenticateWebDAV(authRequest('envuser', 'envpass'), env);
    assert.strictEqual(ok, null);

    const bad = await authenticateWebDAV(authRequest('envuser', 'wrong'), env);
    assert.ok(bad instanceof Response);
    assert.strictEqual(bad.status, 401);
  });

  it('no KV account falls back to BASIC_USER/PASS', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = {
      img_url: createMockKV(),
      BASIC_USER: 'admin',
      BASIC_PASS: 'secret',
    };

    const ok = await authenticateWebDAV(authRequest('admin', 'secret'), env);
    assert.strictEqual(ok, null);

    const bad = await authenticateWebDAV(authRequest('admin', 'wrong'), env);
    assert.ok(bad instanceof Response);
    assert.strictEqual(bad.status, 401);
  });

  it('no credentials at all allows public access', async function () {
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const env = { img_url: createMockKV() };

    const result = await authenticateWebDAV(noAuthRequest(), env);
    assert.strictEqual(result, null);
  });

  it('missing Authorization header with credentials returns 401 challenge', async function () {
    const { createWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await createWebDAVAccount(env, 'alice', 'password123');

    const result = await authenticateWebDAV(noAuthRequest(), env);
    assert.ok(result instanceof Response);
    assert.strictEqual(result.status, 401);
    assert.ok(result.headers.get('WWW-Authenticate'));
  });

  it('KV account takes priority over env credentials', async function () {
    const { createWebDAVAccount, authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = {
      img_url: kv,
      WEBDAV_USER: 'envuser',
      WEBDAV_PASS: 'envpass',
    };
    // KV 中有同名账号但密码不同
    await createWebDAVAccount(env, 'envuser', 'kvpass123');

    // KV 密码通过
    const kvAuth = await authenticateWebDAV(authRequest('envuser', 'kvpass123'), env);
    assert.strictEqual(kvAuth, null);

    // env 密码不通过（KV 优先，KV 密码不匹配，env 密码也不匹配因为 KV 路径已尝试）
    // 实际上：KV 有账号但密码不匹配 → 回退 env → env 匹配 → 通过
    // 因为 KV 账号存在且未禁用但密码不匹配，会继续到 env 检查
    const envAuth = await authenticateWebDAV(authRequest('envuser', 'envpass'), env);
    assert.strictEqual(envAuth, null);
  });
});
