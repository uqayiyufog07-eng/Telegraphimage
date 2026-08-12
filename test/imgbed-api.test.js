const assert = require('assert');
const { createMockKV, installFetchMock, makeContext, muteConsole } = require('./helpers');

const BASE_META = {
  fileName: 'cat.png',
  fileSize: 1234,
  TimeStamp: 1700000000000,
  provider: 'telegram',
  liked: false,
  ListType: 'None',
  Label: 'None',
};

describe('imgbed api', function () {
  let restoreConsole;
  let fetchMock;

  beforeEach(function () {
    restoreConsole = muteConsole();
  });

  afterEach(function () {
    if (fetchMock) {
      fetchMock.restore();
      fetchMock = null;
    }
    restoreConsole();
  });

  describe('GET /api/imgbed/get', function () {
    let mod;

    before(async function () {
      mod = await import('../functions/api/imgbed/get.js');
    });

    it('returns full metadata for an existing file', async function () {
      const img_url = createMockKV({
        'abc.png': { value: '', metadata: { ...BASE_META, shortId: 'AbC123', liked: true } },
      });
      const request = new Request('https://example.com/api/imgbed/get?id=abc.png');
      const res = await mod.onRequestGet(makeContext({ request, env: { img_url } }));

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.id, 'abc.png');
      assert.strictEqual(body.fileName, 'cat.png');
      assert.strictEqual(body.fileSize, 1234);
      assert.strictEqual(body.timeStamp, 1700000000000);
      assert.strictEqual(body.provider, 'telegram');
      assert.strictEqual(body.shortId, 'AbC123');
      assert.strictEqual(body.liked, true);
      assert.strictEqual(body.src, '/file/AbC123');
    });

    it('returns 404 when id is missing', async function () {
      const img_url = createMockKV();
      const request = new Request('https://example.com/api/imgbed/get');
      const res = await mod.onRequestGet(makeContext({ request, env: { img_url } }));
      assert.strictEqual(res.status, 404);
      assert.strictEqual((await res.json()).error, 'missing_id');
    });

    it('returns 404 when the file does not exist', async function () {
      const img_url = createMockKV();
      const request = new Request('https://example.com/api/imgbed/get?id=nope');
      const res = await mod.onRequestGet(makeContext({ request, env: { img_url } }));
      assert.strictEqual(res.status, 404);
      assert.strictEqual((await res.json()).error, 'not_found');
    });
  });

  describe('POST /api/imgbed/rename', function () {
    let mod;

    before(async function () {
      mod = await import('../functions/api/imgbed/rename.js');
    });

    async function post(body, env) {
      const request = new Request('https://example.com/api/imgbed/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return mod.onRequestPost(makeContext({ request, env }));
    }

    it('renames an existing file', async function () {
      const img_url = createMockKV({ 'abc.png': { value: '', metadata: { ...BASE_META } } });
      const res = await post({ id: 'abc.png', fileName: 'new.png' }, { img_url });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.fileName, 'new.png');
      assert.strictEqual(img_url.snapshot('abc.png').metadata.fileName, 'new.png');
    });

    it('returns 400 when id is missing', async function () {
      const img_url = createMockKV();
      const res = await post({ fileName: 'new.png' }, { img_url });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, 'missing_id');
    });

    it('returns 400 when fileName is missing', async function () {
      const img_url = createMockKV();
      const res = await post({ id: 'abc.png' }, { img_url });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, 'missing_fileName');
    });

    it('returns 404 when the file does not exist', async function () {
      const img_url = createMockKV();
      const res = await post({ id: 'nope', fileName: 'x.png' }, { img_url });
      assert.strictEqual(res.status, 404);
      assert.strictEqual((await res.json()).error, 'not_found');
    });
  });

  describe('POST /api/imgbed/like', function () {
    let mod;

    before(async function () {
      mod = await import('../functions/api/imgbed/like.js');
    });

    async function post(body, env) {
      const request = new Request('https://example.com/api/imgbed/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return mod.onRequestPost(makeContext({ request, env }));
    }

    it('toggles liked when no value is provided', async function () {
      const img_url = createMockKV({ 'abc.png': { value: '', metadata: { ...BASE_META, liked: false } } });
      const res = await post({ id: 'abc.png' }, { img_url });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.liked, true);
      assert.strictEqual(img_url.snapshot('abc.png').metadata.liked, true);
    });

    it('sets liked to the provided value', async function () {
      const img_url = createMockKV({ 'abc.png': { value: '', metadata: { ...BASE_META, liked: true } } });
      const res = await post({ id: 'abc.png', liked: false }, { img_url });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.liked, false);
      assert.strictEqual(img_url.snapshot('abc.png').metadata.liked, false);
    });

    it('returns 400 when id is missing', async function () {
      const img_url = createMockKV();
      const res = await post({}, { img_url });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, 'missing_id');
    });

    it('returns 404 when the file does not exist', async function () {
      const img_url = createMockKV();
      const res = await post({ id: 'nope' }, { img_url });
      assert.strictEqual(res.status, 404);
      assert.strictEqual((await res.json()).error, 'not_found');
    });
  });

  describe('POST /api/imgbed/upload', function () {
    let mod;

    before(async function () {
      mod = await import('../functions/api/imgbed/upload.js');
    });

    async function createUploadRequest(file) {
      const formData = new FormData();
      formData.append('file', file);
      return new Request('https://example.com/api/imgbed/upload', {
        method: 'POST',
        body: formData,
      });
    }

    it('uploads a file and returns the src', async function () {
      const img_url = createMockKV();

      fetchMock = installFetchMock(async (input, init) => {
        assert.strictEqual(String(input), 'https://api.telegram.org/botbot-token/sendDocument');
        assert.ok(init.body.get('document') instanceof File);
        return Response.json({ ok: true, result: { document: { file_id: 'doc-id' } } });
      });

      const request = await createUploadRequest(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      const res = await mod.onRequestPost(makeContext({
        request,
        env: {
          disable_telemetry: 'true',
          TG_Bot_Token: 'bot-token',
          TG_Chat_ID: '-100123',
          img_url,
        },
      }));

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(JSON.parse(await res.text()), [{ src: '/file/doc-id.txt' }]);
      assert.strictEqual(img_url.snapshot('doc-id.txt').metadata.fileName, 'notes.txt');
    });

    it('returns an error when the form has no file field', async function () {
      const request = new Request('https://example.com/api/imgbed/upload', {
        method: 'POST',
        body: new FormData(),
      });
      const res = await mod.onRequestPost(makeContext({
        request,
        env: { disable_telemetry: 'true', TG_Bot_Token: 'bot-token', TG_Chat_ID: '-100123' },
      }));

      assert.strictEqual(res.status, 500);
      assert.deepStrictEqual(JSON.parse(await res.text()), { error: 'No file uploaded' });
    });
  });
});