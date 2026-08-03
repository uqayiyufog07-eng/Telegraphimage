const assert = require('assert');
const { makeContext, createMockKV } = require('./helpers');

function jsonRequest(url, payload) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('邀请码管理 /api/manage/invites', function () {
  it('POST create generates an invite code', async function () {
    const { onRequestPost } = await import('../functions/api/manage/invites/[[action]].js');
    const kv = createMockKV();
    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', { maxUses: 5 }),
      env: { img_url: kv },
      params: { action: ['create'] },
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
    assert.ok(body.code.code);
    assert.strictEqual(body.code.code.length, 8);
    assert.strictEqual(body.code.maxUses, 5);
    assert.strictEqual(body.code.usedCount, 0);
    assert.strictEqual(body.code.disabled, false);
  });

  it('GET list returns created invite codes', async function () {
    const { onRequestPost, onRequestGet } = await import('../functions/api/manage/invites/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv };

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));
    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));

    const res = await onRequestGet(makeContext({
      request: new Request('https://example.com/api/manage/invites'),
      env,
    }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.codes.length, 2);
    assert.ok(body.complete);
  });

  it('disable prevents validation and enable restores it', async function () {
    const { onRequestPost, onRequestGet } = await import('../functions/api/manage/invites/[[action]].js');
    const { validateInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const created = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));
    const code = JSON.parse(await created.text()).code.code;

    // disable
    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/disable', { code }),
      env, params: { action: ['disable'] },
    }));

    const disabledCheck = await validateInviteCode(env, code);
    assert.strictEqual(disabledCheck.valid, false);
    assert.strictEqual(disabledCheck.reason, 'disabled');

    // enable
    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/enable', { code }),
      env, params: { action: ['enable'] },
    }));

    const enabledCheck = await validateInviteCode(env, code);
    assert.strictEqual(enabledCheck.valid, true);
  });

  it('delete removes the invite code', async function () {
    const { onRequestPost, onRequestGet } = await import('../functions/api/manage/invites/[[action]].js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const created = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env, params: { action: ['create'] },
    }));
    const code = JSON.parse(await created.text()).code.code;

    await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/delete', { code }),
      env, params: { action: ['delete'] },
    }));

    const list = await onRequestGet(makeContext({
      request: new Request('https://example.com/api/manage/invites'),
      env,
    }));
    const body = JSON.parse(await list.text());
    assert.strictEqual(body.codes.length, 0);
  });

  it('rejects disable/enable/delete without a code', async function () {
    const { onRequestPost } = await import('../functions/api/manage/invites/[[action]].js');
    const kv = createMockKV();

    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/delete', {}),
      env: { img_url: kv },
      params: { action: ['delete'] },
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(JSON.parse(await res.text()).error, 'bad_request');
  });

  it('rejects unknown action with 404', async function () {
    const { onRequestPost } = await import('../functions/api/manage/invites/[[action]].js');
    const kv = createMockKV();

    const res = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/bogus', {}),
      env: { img_url: kv },
      params: { action: ['bogus'] },
    }));
    assert.strictEqual(res.status, 404);
  });

  it('returns 503 when KV is not bound', async function () {
    const { onRequestGet, onRequestPost } = await import('../functions/api/manage/invites/[[action]].js');
    const getRes = await onRequestGet(makeContext({ env: {} }));
    assert.strictEqual(getRes.status, 503);
    const postRes = await onRequestPost(makeContext({
      request: jsonRequest('https://example.com/api/manage/invites/create', {}),
      env: {},
      params: { action: ['create'] },
    }));
    assert.strictEqual(postRes.status, 503);
  });
});

describe('邀请码校验逻辑（users.js 工具函数）', function () {
  it('expired invite code fails validation', async function () {
    const { createInviteCode, validateInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const past = new Date(Date.now() - 86400000).toISOString(); // 1 天前
    const record = await createInviteCode(env, { expiresAt: past });
    const check = await validateInviteCode(env, record.code);
    assert.strictEqual(check.valid, false);
    assert.strictEqual(check.reason, 'expired');
  });

  it('exhausted invite code fails validation', async function () {
    const { createInviteCode, consumeInviteCode, validateInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const record = await createInviteCode(env, { maxUses: 1 });
    await consumeInviteCode(env, record.code, 'alice');

    const check = await validateInviteCode(env, record.code);
    assert.strictEqual(check.valid, false);
    assert.strictEqual(check.reason, 'exhausted');
  });

  it('consuming increments usedCount and records lastUsedBy', async function () {
    const { createInviteCode, consumeInviteCode, getInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const record = await createInviteCode(env, { maxUses: 3 });
    const ok = await consumeInviteCode(env, record.code, 'bob');
    assert.strictEqual(ok, true);

    const updated = await getInviteCode(env, record.code);
    assert.strictEqual(updated.usedCount, 1);
    assert.strictEqual(updated.lastUsedBy, 'bob');
  });

  it('invite code is case-insensitive', async function () {
    const { createInviteCode, validateInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const record = await createInviteCode(env, {});
    // 转小写验证应仍通过
    const lower = record.code.toLowerCase();
    const check = await validateInviteCode(env, lower);
    assert.strictEqual(check.valid, true);
  });

  it('non-existent code fails with not_found', async function () {
    const { validateInviteCode } = await import('../functions/utils/users.js');
    const kv = createMockKV();
    const env = { img_url: kv };

    const check = await validateInviteCode(env, 'NOTREAL1');
    assert.strictEqual(check.valid, false);
    assert.strictEqual(check.reason, 'not_found');
  });
});
