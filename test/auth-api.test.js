const assert = require('assert');
const { makeContext, createMockKV } = require('./helpers');

function jsonRequest(url, payload, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function cookieOf(res) {
  const setCookie = res.headers.get('Set-Cookie') || '';
  const match = setCookie.match(/wb_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe('用户系统 /api/auth', function () {
  it('rejects registration when KV is not bound', async function () {
    const { onRequestPost } = await import('../functions/api/auth/register.js');
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' }),
      env: {},
    }));
    assert.strictEqual(res.status, 503);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.error, 'auth_unavailable');
  });

  it('rejects registration when AUTH_REGISTER=false', async function () {
    const { onRequestPost } = await import('../functions/api/auth/register.js');
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' }),
      env: { img_url: createMockKV(), AUTH_REGISTER: 'false' },
    }));
    assert.strictEqual(res.status, 403);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.error, 'registration_closed');
  });

  it('validates username and password on registration', async function () {
    const { onRequestPost } = await import('../functions/api/auth/register.js');
    const kv = createMockKV();
    const cases = [
      [{ username: 'ab', password: 'password123' }, 'username'],
      [{ username: 'has space', password: 'password123' }, 'username'],
      [{ username: 'alice', password: 'short' }, 'password'],
      [{ username: '', password: '' }, 'username'],
    ];
    for (const [payload, field] of cases) {
      const res = await onRequestPost(makeContext({
        request: jsonRequest('https://example.com/api/auth/register', payload),
        env: { img_url: kv },
      }));
      assert.strictEqual(res.status, 400, JSON.stringify(payload));
      const body = JSON.parse(await res.text());
      assert.strictEqual(body.field, field);
    }
  });

  it('registers a user, hashes the password and sets a session cookie', async function () {
    const { onRequestPost } = await import('../functions/api/auth/register.js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' }),
      env: { img_url: kv },
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.user.username, 'alice');
    assert.ok(cookieOf(res), 'session cookie is set');

    const stored = kv.snapshot('user:alice');
    assert.ok(stored, 'user record stored in KV');
    const record = JSON.parse(stored.value);
    assert.ok(!stored.value.includes('password123'), 'plaintext password is never stored');
    assert.ok(record.passHash && record.salt, 'hash and salt are stored');
  });

  it('rejects duplicate usernames', async function () {
    const { onRequestPost } = await import('../functions/api/auth/register.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    const req = () => jsonRequest('https://example.com/api/auth/register', { username: 'alice', password: 'password123' });
    await onRequestPost(makeContext({ request: req(), env }));
    const res = await onRequestPost(makeContext({ request: req(), env }));
    assert.strictEqual(res.status, 409);
  });

  it('logs in with correct credentials and rejects wrong ones', async function () {
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'bob', password: 'password123' }),
      env,
    }));

    const bad = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'bob', password: 'wrong-pass' }),
      env,
    }));
    assert.strictEqual(bad.status, 401);
    assert.ok(!cookieOf(bad), 'no cookie on failed login');

    const good = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'bob', password: 'password123' }),
      env,
    }));
    assert.strictEqual(good.status, 200);
    assert.ok(cookieOf(good), 'cookie on successful login');
  });

  it('locks the account after repeated failures', async function () {
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const kv = createMockKV();
    const env = { img_url: kv };
    await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'carol', password: 'password123' }),
      env,
    }));

    let last;
    for (let i = 0; i < 5; i++) {
      last = await login(makeContext({
        request: jsonRequest('https://example.com/api/auth/login', { username: 'carol', password: 'nope-nope' }),
        env,
      }));
    }
    assert.strictEqual(last.status, 401, '第 5 次失败仍是普通 401');

    // 第 6 次触发锁定，即使密码正确也拒绝
    const blocked = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'carol', password: 'password123' }),
      env,
    }));
    assert.strictEqual(blocked.status, 429);
  });

  it('me reports the session user and logout clears it', async function () {
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    const { onRequestGet: me } = await import('../functions/api/auth/me.js');
    const { onRequestPost: logout } = await import('../functions/api/auth/logout.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const reg = await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username: 'dave', password: 'password123' }),
      env,
    }));
    const token = cookieOf(reg);
    assert.ok(token);

    const authed = await me(makeContext({
      request: new Request('https://example.com/api/auth/me', {
        headers: { Cookie: `wb_session=${encodeURIComponent(token)}` },
      }),
      env,
    }));
    const authedBody = JSON.parse(await authed.text());
    assert.strictEqual(authedBody.user.username, 'dave');
    assert.strictEqual(authedBody.authEnabled, true);
    assert.strictEqual(authedBody.registrationOpen, true);

    const out = await logout(makeContext({
      request: new Request('https://example.com/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: `wb_session=${encodeURIComponent(token)}` },
      }),
      env,
    }));
    assert.strictEqual(out.status, 200);
    assert.ok(!kv.snapshot('sess:' + token), 'session record removed');

    const anon = await me(makeContext({
      request: new Request('https://example.com/api/auth/me', {
        headers: { Cookie: `wb_session=${encodeURIComponent(token)}` },
      }),
      env,
    }));
    assert.strictEqual(JSON.parse(await anon.text()).user, null);
  });

  it('me reports auth disabled without KV', async function () {
    const { onRequestGet: me } = await import('../functions/api/auth/me.js');
    const res = await me(makeContext({ env: {} }));
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.authEnabled, false);
    assert.strictEqual(body.user, null);
  });
});

describe('后台用户管理 /api/manage/users', function () {
  async function seedUser(kv, username) {
    const { onRequestPost: register } = await import('../functions/api/auth/register.js');
    await register(makeContext({
      request: jsonRequest('https://example.com/api/auth/register', { username, password: 'password123' }),
      env: { img_url: kv },
    }));
  }

  it('lists registered users without hash material', async function () {
    const kv = createMockKV();
    await seedUser(kv, 'alice');
    await seedUser(kv, 'bob');

    const { onRequestGet } = await import('../functions/api/manage/users/[[action]].js');
    const res = await onRequestGet(makeContext({ env: { img_url: kv } }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.users.length, 2);
    assert.deepStrictEqual(body.users.map(u => u.username), ['alice', 'bob']);
    assert.ok(!JSON.stringify(body).includes('passHash'), 'no hash material leaks');
  });

  it('disable blocks session login and enable restores it', async function () {
    const kv = createMockKV();
    await seedUser(kv, 'alice');
    const env = { img_url: kv };

    const { onRequestPost } = await import('../functions/api/manage/users/[[action]].js');
    const disable = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/users/disable', { username: 'alice' }),
      env, params: { action: ['disable'] },
    }));
    assert.strictEqual(disable.status, 200);
    assert.ok(JSON.parse(kv.snapshot('user:alice').value).disabled);

    // 禁用后会话视为无效
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'alice', password: 'password123' }),
      env,
    }));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(JSON.parse(await res.text()).error, 'account_disabled');

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/users/enable', { username: 'alice' }),
      env, params: { action: ['enable'] },
    }));
    assert.ok(!JSON.parse(kv.snapshot('user:alice').value).disabled);
  });

  it('resets a password and deletes a user with their sessions', async function () {
    const kv = createMockKV();
    await seedUser(kv, 'alice');
    const env = { img_url: kv };
    const { onRequestPost } = await import('../functions/api/manage/users/[[action]].js');

    const weak = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/users/reset', { username: 'alice', password: 'x' }),
      env, params: { action: ['reset'] },
    }));
    assert.strictEqual(weak.status, 400);

    const reset = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/users/reset', { username: 'alice', password: 'newpassword456' }),
      env, params: { action: ['reset'] },
    }));
    assert.strictEqual(reset.status, 200);

    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const oldLogin = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'alice', password: 'password123' }),
      env,
    }));
    assert.strictEqual(oldLogin.status, 401, 'old password stops working');

    // 登录一次产生会话，随后删除用户应清掉会话
    const okLogin = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { username: 'alice', password: 'newpassword456' }),
      env,
    }));
    assert.strictEqual(okLogin.status, 200);

    const del = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/users/delete', { username: 'alice' }),
      env, params: { action: ['delete'] },
    }));
    assert.strictEqual(del.status, 200);
    assert.ok(!kv.snapshot('user:alice'), 'user record removed');
    const remainingSessions = kv.operations.delete.filter(k => k.startsWith('sess:'));
    assert.ok(remainingSessions.length >= 1, 'user sessions are purged on delete');
  });

  it('requires KV for user management', async function () {
    const { onRequestGet } = await import('../functions/api/manage/users/[[action]].js');
    const res = await onRequestGet(makeContext({ env: {} }));
    assert.strictEqual(res.status, 503);
  });
});
