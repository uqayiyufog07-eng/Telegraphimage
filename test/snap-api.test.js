const assert = require('assert');
const {
  onRequestPost,
  onRequestGet,
  onRequestDelete,
} = require('../functions/api/snap/[[room]].js');
const { createMockKV, makeContext } = require('./helpers.js');

function post(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const OFFER = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n(fake offer sdp)';
const ANSWER = 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\ns=-\r\n(fake answer sdp)';

async function createRoom(env, offer = OFFER) {
  const res = await onRequestPost(makeContext({
    request: post('https://x.com/api/snap', { offer }),
    env,
  }));
  return res;
}

describe('snap signaling api', function () {
  it('creates a room and stores SDP in value (not metadata)', async function () {
    const img_url = createMockKV();
    const env = { img_url };
    const res = await createRoom(env);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.code, /^[A-Za-z0-9]{6}$/);
    assert.strictEqual(data.ttl, 300);

    const stored = img_url.snapshot('snap:' + data.code);
    const room = JSON.parse(stored.value);
    assert.strictEqual(room.offer, OFFER);
    assert.strictEqual(room.status, 'waiting');
    // metadata 必须保持小体积（1024 字节限制），不含 SDP
    assert.ok(!stored.metadata.offer, 'offer must not be in metadata');
  });

  it('requires offer and valid JSON', async function () {
    const env = { img_url: createMockKV() };
    const noOffer = await onRequestPost(makeContext({
      request: post('https://x.com/api/snap', {}), env,
    }));
    assert.strictEqual(noOffer.status, 400);
    const badJson = await onRequestPost(makeContext({
      request: new Request('https://x.com/api/snap', { method: 'POST', body: '{bad' }), env,
    }));
    assert.strictEqual(badJson.status, 400);
  });

  it('fails clearly without KV binding', async function () {
    const res = await onRequestPost(makeContext({
      request: post('https://x.com/api/snap', { offer: OFFER }), env: {},
    }));
    assert.strictEqual(res.status, 500);
  });

  it('rejects oversized offers', async function () {
    const env = { img_url: createMockKV() };
    const res = await onRequestPost(makeContext({
      request: post('https://x.com/api/snap', { offer: 'x'.repeat(65 * 1024) }), env,
    }));
    assert.strictEqual(res.status, 413);
  });

  it('full handshake: offer → answer → ICE both sides stay isolated', async function () {
    const img_url = createMockKV();
    const env = { img_url };
    const code = (await (await createRoom(env)).json()).code;

    // callee fetches offer
    let res = await onRequestGet(makeContext({
      request: new Request(`https://x.com/api/snap/${code}`), env,
    }));
    let room = await res.json();
    assert.strictEqual(room.offer, OFFER);
    assert.deepStrictEqual(room.callerIce, []);

    // caller sends ICE, callee sends ICE (independent keys — no overwrite)
    await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { ice: '{"candidate":"c1"}', side: 'caller' }), env,
    }));
    await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { ice: '{"candidate":"e1"}', side: 'callee' }), env,
    }));
    // batch ICE submit
    await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { ice: ['{"candidate":"c2"}', '{"candidate":"c3"}'], side: 'caller' }), env,
    }));

    // callee submits answer
    res = await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { answer: ANSWER }), env,
    }));
    assert.strictEqual(res.status, 200);

    res = await onRequestGet(makeContext({
      request: new Request(`https://x.com/api/snap/${code}`), env,
    }));
    room = await res.json();
    assert.strictEqual(room.answer, ANSWER);
    assert.strictEqual(room.status, 'answered');
    assert.deepStrictEqual(room.callerIce, ['{"candidate":"c1"}', '{"candidate":"c2"}', '{"candidate":"c3"}']);
    assert.deepStrictEqual(room.calleeIce, ['{"candidate":"e1"}']);
  });

  it('caps ICE list per side', async function () {
    const img_url = createMockKV();
    const env = { img_url };
    const code = (await (await createRoom(env)).json()).code;
    const batch = Array.from({ length: 20 }, (_, i) => `{"candidate":"x${i}"}`);
    for (let i = 0; i < 4; i++) {
      await onRequestPost(makeContext({
        request: post(`https://x.com/api/snap/${code}`, { ice: batch, side: 'caller' }), env,
      }));
    }
    const res = await onRequestGet(makeContext({
      request: new Request(`https://x.com/api/snap/${code}`), env,
    }));
    const room = await res.json();
    assert.strictEqual(room.callerIce.length, 50);
  });

  it('rejects invalid side and invalid room code', async function () {
    const img_url = createMockKV();
    const env = { img_url };
    const code = (await (await createRoom(env)).json()).code;
    const res = await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { ice: 'x', side: 'hacker' }), env,
    }));
    assert.strictEqual(res.status, 400);

    const badCode = await onRequestPost(makeContext({
      request: post('https://x.com/api/snap/bad!!code', { ice: 'x', side: 'caller' }), env,
    }));
    assert.strictEqual(badCode.status, 400);
  });

  it('404 for unknown room; delete removes room and both ICE keys', async function () {
    const img_url = createMockKV();
    const env = { img_url };
    const missing = await onRequestGet(makeContext({
      request: new Request('https://x.com/api/snap/ZZZZ99'), env,
    }));
    assert.strictEqual(missing.status, 404);

    const code = (await (await createRoom(env)).json()).code;
    await onRequestPost(makeContext({
      request: post(`https://x.com/api/snap/${code}`, { ice: '{"candidate":"c1"}', side: 'caller' }), env,
    }));
    const del = await onRequestDelete(makeContext({
      request: new Request(`https://x.com/api/snap/${code}`, { method: 'DELETE' }), env,
    }));
    assert.strictEqual(del.status, 200);
    assert.strictEqual(img_url.snapshot('snap:' + code), undefined);
    assert.strictEqual(img_url.snapshot(`snap:${code}:ice:caller`), undefined);
    assert.strictEqual(img_url.snapshot(`snap:${code}:ice:callee`), undefined);
  });

  it('reads legacy v1 rooms stored in metadata', async function () {
    const img_url = createMockKV({
      ['snap:Legacy']: {
        value: '',
        metadata: { status: 'waiting', offer: 'legacy-offer', answer: '', callerIce: ['l1'], calleeIce: [], createdAt: 1 },
      },
    });
    const res = await onRequestGet(makeContext({
      request: new Request('https://x.com/api/snap/Legacy'), env: { img_url },
    }));
    assert.strictEqual(res.status, 200);
    const room = await res.json();
    assert.strictEqual(room.offer, 'legacy-offer');
    assert.deepStrictEqual(room.callerIce, ['l1']);
  });
});
