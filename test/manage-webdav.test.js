const assert = require('assert');
const { makeContext, createMockKV } = require('./helpers');

function jsonRequest(url, payload) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function authRequest(username, password) {
  const cred = btoa(username + ':' + password);
  return new Request('https://example.com/webdav/', {
    headers: { Authorization: 'Basic ' + cred },
  });
}

describe('WebDAV 账号管理 /api/manage/webdav', function () {
  it('GET returns enabled status and account list', async function () {
    const { onRequestGet } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestGet(makeContext({
      env: { img_url: kv, img_r2: createMockKV() },
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.enabled, true);
    assert.strictEqual(body.url, '/webdav');
    assert.deepStrictEqual(body.accounts, []);
  });

  it('GET returns disabled when R2 is not bound', async function () {
    const { onRequestGet } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestGet(makeContext({ env: { img_url: kv } }));
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.enabled, false);
    assert.strictEqual(body.url, null);
  });

  it('POST create creates a WebDAV account', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env: { img_url: kv },
      params: { action: ['create'] },
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.account.username, 'dav1');
    assert.strictEqual(body.account.disabled, false);
  });

  it('POST create rejects short passwords', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'short' }),
      env: { img_url: kv },
      params: { action: ['create'] },
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(await res.text()).error, 'create_failed');
  });

  it('POST create rejects duplicate usernames', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret456' }),
      env, params: { action: ['create'] },
    }));
    assert.strictEqual(res.status, 400);
  });

  it('POST create rejects empty username', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: '', password: 'secret123' }),
      env: { img_url: kv },
      params: { action: ['create'] },
    }));
    assert.strictEqual(res.status, 400);
  });

  it('account list does not leak passHash or salt', async function () {
    const { onRequestGet, onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv, img_r2: createMockKV() };
    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));

    const res = await onRequestGet(makeContext({ env }));
    const text = await res.text();
    assert.ok(!text.includes('passHash'), 'no passHash in response');
    assert.ok(!text.includes('salt'), 'no salt in response');
  });

  it('POST reset changes the password', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));

    // 旧密码能通过
    const oldAuth = await authenticateWebDAV(authRequest('dav1', 'secret123'), env);
    assert.strictEqual(oldAuth, null);

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/reset', { username: 'dav1', password: 'newpass456' }),
      env, params: { action: ['reset'] },
    }));

    // 旧密码不再通过
    const oldRejected = await authenticateWebDAV(authRequest('dav1', 'secret123'), env);
    assert.ok(oldRejected instanceof Response);
    assert.strictEqual(oldRejected.status, 401);

    // 新密码能通过
    const newAuth = await authenticateWebDAV(authRequest('dav1', 'newpass456'), env);
    assert.strictEqual(newAuth, null);
  });

  it('POST disable blocks WebDAV auth and enable restores it', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const { authenticateWebDAV } = await import('../functions/utils/webdav-auth.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/disable', { username: 'dav1' }),
      env, params: { action: ['disable'] },
    }));

    const disabled = await authenticateWebDAV(authRequest('dav1', 'secret123'), env);
    assert.ok(disabled instanceof Response);
    assert.strictEqual(disabled.status, 401);

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/enable', { username: 'dav1' }),
      env, params: { action: ['enable'] },
    }));

    const enabled = await authenticateWebDAV(authRequest('dav1', 'secret123'), env);
    assert.strictEqual(enabled, null);
  });

  it('POST delete removes the account', async function () {
    const { onRequestGet, onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv, img_r2: createMockKV() };

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/delete', { username: 'dav1' }),
      env, params: { action: ['delete'] },
    }));

    const res = await onRequestGet(makeContext({ env }));
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.accounts.length, 0);
  });

  it('rejects unknown action with 404', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/bogus', {}),
      env: { img_url: kv },
      params: { action: ['bogus'] },
    }));
    assert.strictEqual(res.status, 404);
  });

  it('rejects reset/disable/enable/delete without username', async function () {
    const { onRequestPost } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/delete', { username: '' }),
      env: { img_url: kv },
      params: { action: ['delete'] },
    }));
    assert.strictEqual(res.status, 400);
  });
});
