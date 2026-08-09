const assert = require('assert');
const { makeContext } = require('./helpers');

function jsonRequest(url, payload, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function ownerCookieOf(res) {
  const setCookie = res.headers.get('Set-Cookie') || '';
  const match = setCookie.match(/wb_owner=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe('所有者鉴权 /api/auth', function () {
  it('未配置密码时登录返回 400 auth_not_configured', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: 'whatever' }),
      env: {},
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(await res.text()).error, 'auth_not_configured');
  });

  it('正确密码登录成功并设置 wb_owner Cookie', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: 's3cret-pass' }),
      env: { OWNER_PASSWORD: 's3cret-pass' },
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
    assert.ok(ownerCookieOf(res), 'wb_owner cookie set');
  });

  it('错误密码返回 401 且不设置 Cookie', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: 'wrong' }),
      env: { OWNER_PASSWORD: 's3cret-pass' },
    }));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(JSON.parse(await res.text()).error, 'invalid_password');
    assert.ok(!ownerCookieOf(res));
  });

  it('空密码返回 400', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: '' }),
      env: { OWNER_PASSWORD: 's3cret-pass' },
    }));
    assert.strictEqual(res.status, 400);
  });

  it('BASIC_PASS 回退作为所有者密码', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const res = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: 'basicpass' }),
      env: { BASIC_PASS: 'basicpass' },
    }));
    assert.strictEqual(res.status, 200);
    assert.ok(ownerCookieOf(res));
  });

  it('me 反映登录态：未配置 / 已登录 / 未登录', async function () {
    const { onRequestPost: login } = await import('../functions/api/auth/login.js');
    const { onRequestGet: me } = await import('../functions/api/auth/me.js');
    const env = { OWNER_PASSWORD: 's3cret-pass' };

    // 未配置
    const disabled = await me(makeContext({ env: {} }));
    const disabledBody = JSON.parse(await disabled.text());
    assert.strictEqual(disabledBody.authEnabled, false);
    assert.strictEqual(disabledBody.loggedIn, false);

    // 登录拿 cookie
    const reg = await login(makeContext({
      request: jsonRequest('https://example.com/api/auth/login', { password: 's3cret-pass' }),
      env,
    }));
    const cookie = ownerCookieOf(reg);
    assert.ok(cookie);

    // 已登录
    const authed = await me(makeContext({
      request: new Request('https://example.com/api/auth/me', {
        headers: { Cookie: `wb_owner=${encodeURIComponent(cookie)}` },
      }),
      env,
    }));
    const authedBody = JSON.parse(await authed.text());
    assert.strictEqual(authedBody.authEnabled, true);
    assert.strictEqual(authedBody.loggedIn, true);
    assert.strictEqual(authedBody.owner, true);

    // 未登录（无 cookie）
    const anon = await me(makeContext({
      request: new Request('https://example.com/api/auth/me'),
      env,
    }));
    const anonBody = JSON.parse(await anon.text());
    assert.strictEqual(anonBody.authEnabled, true);
    assert.strictEqual(anonBody.loggedIn, false);
  });

  it('篡改的 Cookie 不被视为登录态', async function () {
    const { onRequestGet: me } = await import('../functions/api/auth/me.js');
    const env = { OWNER_PASSWORD: 's3cret-pass' };
    const res = await me(makeContext({
      request: new Request('https://example.com/api/auth/me', {
        headers: { Cookie: 'wb_owner=eyJvayI6dHJ1ZX0.bogussignature' },
      }),
      env,
    }));
    assert.strictEqual(JSON.parse(await res.text()).loggedIn, false);
  });

  it('logout 清除 wb_owner Cookie', async function () {
    const { onRequestPost: logout } = await import('../functions/api/auth/logout.js');
    const res = await logout(makeContext({
      request: new Request('https://example.com/api/auth/logout', { method: 'POST' }),
      env: { OWNER_PASSWORD: 's3cret-pass' },
    }));
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get('Set-Cookie') || '';
    assert.ok(/wb_owner=;/.test(setCookie), 'cookie cleared');
    assert.ok(/Max-Age=0/.test(setCookie));
  });
});
