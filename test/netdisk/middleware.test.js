const assert = require('assert');
const { makeContext, createMockKV } = require('../helpers');

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function run(context) {
  const { onRequest } = await import('../../functions/netdisk/_middleware.js');
  let i = 0;
  // 模拟 Pages Functions 的中间件级联：next() 调用链中的下一个中间件
  context.next = async () => {
    i++;
    if (i >= onRequest.length) return new Response('next');
    return onRequest[i](context);
  };
  return onRequest[0](context);
}

describe('netdisk 中间件', function () {
  it('API 路由在缺少 R2 绑定时返回 503 JSON', async function () {
    const res = await run(makeContext({
      request: new Request('https://example.com/netdisk/api/list'),
      env: {},
    }));
    assert.strictEqual(res.status, 503);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.error, 'r2_unbound');
  });

  it('未配置 BASIC 时公开访问', async function () {
    const res = await run(makeContext({
      request: new Request('https://example.com/netdisk/'),
      env: { img_r2: {} },
    }));
    assert.strictEqual(await res.text(), 'next');
  });

  it('配置了 BASIC 且无凭证时：API 返回 401 JSON，页面跳转登录', async function () {
    const env = { img_r2: {}, img_url: createMockKV(), BASIC_USER: 'admin', BASIC_PASS: 'pass' };

    const apiRes = await run(makeContext({
      request: new Request('https://example.com/netdisk/api/list'),
      env,
    }));
    assert.strictEqual(apiRes.status, 401);
    assert.strictEqual(JSON.parse(await apiRes.text()).error, 'auth_required');

    const pageRes = await run(makeContext({
      request: new Request('https://example.com/netdisk/'),
      env,
    }));
    assert.strictEqual(pageRes.status, 302);
    assert.ok(pageRes.headers.get('Location').startsWith('https://example.com/auth?next='));
  });

  it('无用户系统时回退为 BASIC 弹窗', async function () {
    const res = await run(makeContext({
      request: new Request('https://example.com/netdisk/'),
      env: { img_r2: {}, BASIC_USER: 'admin', BASIC_PASS: 'pass' },
    }));
    assert.strictEqual(res.status, 401);
    assert.ok(res.headers.get('WWW-Authenticate'));
  });

  it('Basic 凭证正确时放行，错误时 401', async function () {
    const env = { img_r2: {}, BASIC_USER: 'admin', BASIC_PASS: 'pass' };

    const ok = await run(makeContext({
      request: new Request('https://example.com/netdisk/', {
        headers: { Authorization: basic('admin', 'pass') },
      }),
      env,
    }));
    assert.strictEqual(await ok.text(), 'next');

    const bad = await run(makeContext({
      request: new Request('https://example.com/netdisk/', {
        headers: { Authorization: basic('admin', 'wrong') },
      }),
      env,
    }));
    assert.strictEqual(bad.status, 401);
  });

  it('登录用户的会话 Cookie 可免密访问', async function () {
    const kv = createMockKV();
    const env = { img_r2: {}, img_url: kv, BASIC_USER: 'admin', BASIC_PASS: 'pass' };

    // 注册一个用户拿到会话
    const { onRequestPost: register } = await import('../../functions/api/auth/register.js');
    const reg = await register(makeContext({
      request: new Request('https://example.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password123' }),
      }),
      env,
    }));
    const token = (reg.headers.get('Set-Cookie') || '').match(/wb_session=([^;]*)/)[1];

    const res = await run(makeContext({
      request: new Request('https://example.com/netdisk/', {
        headers: { Cookie: `wb_session=${token}` },
      }),
      env,
    }));
    assert.strictEqual(await res.text(), 'next');
  });
});
