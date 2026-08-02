const assert = require('assert');
const { onRequestPost } = require('../functions/api/lan/relay.js');
const { installFetchMock, makeContext } = require('./helpers.js');

function relayRequest(target, opts = {}) {
  const headers = { 'X-Lan-Target': target };
  if (opts.method) headers['X-Lan-Method'] = opts.method;
  if (opts.contentType) headers['Content-Type'] = opts.contentType;
  return new Request('https://example.com/api/lan/relay', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

describe('lan relay function', function () {
  it('rejects requests without X-Lan-Target', async function () {
    const res = await onRequestPost(makeContext({
      request: new Request('https://example.com/api/lan/relay', { method: 'POST' }),
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('rejects public IP targets (no open proxy)', async function () {
    const res = await onRequestPost(makeContext({
      request: relayRequest('http://8.8.8.8:53/'),
    }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /私有地址/);
  });

  it('rejects cloud metadata addresses', async function () {
    for (const target of ['http://169.254.169.254/latest', 'http://0.0.0.0/']) {
      const res = await onRequestPost(makeContext({ request: relayRequest(target) }));
      assert.strictEqual(res.status, 400, target);
    }
  });

  it('rejects non-http schemes and credentialed URLs', async function () {
    const ftp = await onRequestPost(makeContext({ request: relayRequest('ftp://192.168.1.5/') }));
    assert.strictEqual(ftp.status, 400);
    const cred = await onRequestPost(makeContext({ request: relayRequest('http://user:pass@192.168.1.5/') }));
    assert.strictEqual(cred.status, 400);
  });

  it('rejects IPv6 bracket hosts', async function () {
    const res = await onRequestPost(makeContext({ request: relayRequest('http://[::1]:53317/') }));
    assert.strictEqual(res.status, 400);
  });

  it('accepts all private IPv4 ranges and *.local', async function () {
    const mock = installFetchMock(async (input) => new Response('ok:' + String(input)));
    try {
      for (const host of ['10.0.0.5', '172.16.3.4', '172.31.255.1', '192.168.1.8', '127.0.0.1', 'localhost', 'my-phone.local']) {
        const res = await onRequestPost(makeContext({
          request: relayRequest(`http://${host}:53317/api/localsend/v2/info`, { method: 'GET' }),
        }));
        assert.strictEqual(res.status, 200, host);
        assert.strictEqual(await res.text(), `ok:http://${host}:53317/api/localsend/v2/info`);
        assert.strictEqual(res.headers.get('X-Lan-Relay'), '1');
      }
    } finally {
      mock.restore();
    }
  });

  it('forwards JSON bodies and content type', async function () {
    const seen = [];
    const mock = installFetchMock(async (input, init) => {
      seen.push({ url: String(input), method: init.method, ct: init.headers['Content-Type'], body: init.body });
      return new Response(JSON.stringify({ sessionId: 's1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const payload = JSON.stringify({ info: { alias: 'Web' }, files: {} });
      const res = await onRequestPost(makeContext({
        request: relayRequest('http://192.168.1.8:53317/api/localsend/v2/prepare-upload', {
          contentType: 'application/json',
          body: payload,
        }),
      }));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('Content-Type'), 'application/json');
      assert.deepStrictEqual(await res.json(), { sessionId: 's1' });
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].method, 'POST');
      assert.strictEqual(seen[0].ct, 'application/json');
    } finally {
      mock.restore();
    }
  });

  it('mirrors upstream status codes (e.g. 401 for PIN)', async function () {
    const mock = installFetchMock(async () => new Response('pin required', { status: 401 }));
    try {
      const res = await onRequestPost(makeContext({
        request: relayRequest('http://192.168.1.8:53317/api/localsend/v2/prepare-upload', {
          contentType: 'application/json',
          body: '{}',
        }),
      }));
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.headers.get('X-Lan-Status'), '401');
    } finally {
      mock.restore();
    }
  });

  it('returns 502 when the target is unreachable', async function () {
    const mock = installFetchMock(async () => { throw new TypeError('fetch failed'); });
    try {
      const res = await onRequestPost(makeContext({
        request: relayRequest('http://192.168.1.8:53317/api/localsend/v2/info', { method: 'GET' }),
      }));
      assert.strictEqual(res.status, 502);
      assert.strictEqual((await res.json()).error, 'target_unreachable');
    } finally {
      mock.restore();
    }
  });
});
