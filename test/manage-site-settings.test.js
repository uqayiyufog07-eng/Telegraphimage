const assert = require('assert');
const { makeContext, createMockKV } = require('./helpers');

function jsonRequest(url, payload) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('站点设置 /api/manage/site-settings', function () {
  it('GET returns default registrationMode when no settings stored', async function () {
    const { onRequestGet } = await import('../functions/api/manage/site-settings.js');
    const kv = createMockKV();
    const res = await onRequestGet(makeContext({ env: { img_url: kv } }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.registrationMode, 'open');
    assert.strictEqual(body.inviteCount, 0);
    assert.strictEqual(body.webdavAccountCount, 0);
    assert.strictEqual(body.updatedAt, null);
  });

  it('GET respects AUTH_REGISTER=false as default closed', async function () {
    const { onRequestGet } = await import('../functions/api/manage/site-settings.js');
    const kv = createMockKV();
    const res = await onRequestGet(makeContext({ env: { img_url: kv, AUTH_REGISTER: 'false' } }));
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.registrationMode, 'closed');
  });

  it('POST switches registrationMode and persists', async function () {
    const { onRequestGet, onRequestPost } = await import('../functions/api/manage/site-settings.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/site-settings', { registrationMode: 'invite' }),
      env,
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.registrationMode, 'invite');
    assert.ok(body.updatedAt);

    // GET 应反映新值
    const get = await onRequestGet(makeContext({ env }));
    const getBody = JSON.parse(await get.text());
    assert.strictEqual(getBody.registrationMode, 'invite');
    assert.ok(getBody.updatedAt);
  });

  it('POST rejects invalid registrationMode', async function () {
    const { onRequestPost } = await import('../functions/api/manage/site-settings.js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/site-settings', { registrationMode: 'bogus' }),
      env: { img_url: kv },
    }));
    assert.strictEqual(res.status, 400);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.error, 'invalid_mode');
  });

  it('POST rejects bad request body', async function () {
    const { onRequestPost } = await import('../functions/api/manage/site-settings.js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: new Request('https://example.com/api/manage/site-settings', {
        method: 'POST',
        body: 'not json',
      }),
      env: { img_url: kv },
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(await res.text()).error, 'bad_request');
  });

  it('returns 503 when KV is not bound', async function () {
    const { onRequestGet, onRequestPost } = await import('../functions/api/manage/site-settings.js');
    const getRes = await onRequestGet(makeContext({ env: {} }));
    assert.strictEqual(getRes.status, 503);
    const postRes = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/site-settings', { registrationMode: 'open' }),
      env: {},
    }));
    assert.strictEqual(postRes.status, 503);
  });

  it('switching to closed makes register.js reject with 403', async function () {
    const { onRequestPost: setSettings } = await import('../functions/api/manage/site-settings.js');
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    await setSettings(makeContext({
      request: jsonRequest('https://example.com/api/manage/site-settings', { registrationMode: 'closed' }),
      env,
    }));

    const res = await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' }),
      env,
    }));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(JSON.parse(await res.text()).error, 'registration_closed');
  });

  it('switching to invite makes register.js require invite code', async function () {
    const { onRequestPost: setSettings } = await import('../functions/api/manage/site-settings.js');
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    await setSettings(makeContext({
      request: jsonRequest('https://example.com/api/manage/site-settings', { registrationMode: 'invite' }),
      env,
    }));

    // 无邀请码 → 400
    const noCode = await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' }),
      env,
    }));
    assert.strictEqual(noCode.status, 400);
    assert.strictEqual(JSON.parse(await noCode.text()).error, 'invite_code_required');

    // 无效邀请码 → 400
    const badCode = await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123', inviteCode: 'NOPE0000' }),
      env,
    }));
    assert.strictEqual(badCode.status, 400);
    assert.strictEqual(JSON.parse(await badCode.text()).error, 'invalid_invite_code');
  });

  it('GET reports inviteCount and webdavAccountCount', async function () {
    const { onRequestGet: getSettings } = await import('../functions/api/manage/site-settings.js');
    const { onRequestPost: createInvite } = await import('../functions/api/manage/invites/[[action]].js');
    const { onRequestPost: createWebDAV } = await import('../functions/api/manage/webdav/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv, img_r2: createMockKV() };

    // 生成 2 个邀请码
    await createInvite(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));
    await createInvite(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));

    // 创建 1 个 WebDAV 账号
    await createWebDAV(makeContext({
      request: jsonRequest('https://example.com/api/manage/webdav/create', { username: 'dav1', password: 'secret123' }),
      env, params: { action: ['create'] },
    }));

    const res = await getSettings(makeContext({ env }));
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.inviteCount, 2);
    assert.strictEqual(body.webdavAccountCount, 1);
  });
});
