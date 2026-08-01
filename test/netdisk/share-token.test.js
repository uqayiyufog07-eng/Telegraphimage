const assert = require('assert');
const { createMockKV } = require('../helpers');

describe('share-token utilities', function () {
  async function getModule() {
    return await import('../../functions/utils/share-token.js');
  }

  describe('generateToken', function () {
    it('generates a token of default length', async function () {
      const { generateToken } = await getModule();
      const token = generateToken();
      assert.strictEqual(token.length, 12);
      assert.ok(/^[A-Za-z0-9]+$/.test(token));
    });

    it('generates a token of custom length', async function () {
      const { generateToken } = await getModule();
      const token = generateToken(8);
      assert.strictEqual(token.length, 8);
    });

    it('generates different tokens on successive calls', async function () {
      const { generateToken } = await getModule();
      const a = generateToken();
      const b = generateToken();
      assert.notStrictEqual(a, b);
    });
  });

  describe('hashPassword / verifyPassword', function () {
    it('hashes a password and verifies it', async function () {
      const { hashPassword, verifyPassword } = await getModule();
      const hash = await hashPassword('secret123');
      assert.ok(hash);
      assert.notStrictEqual(hash, 'secret123');
      assert.strictEqual(await verifyPassword('secret123', hash), true);
      assert.strictEqual(await verifyPassword('wrong', hash), false);
    });

    it('returns empty hash for empty password', async function () {
      const { hashPassword } = await getModule();
      assert.strictEqual(await hashPassword(''), '');
      assert.strictEqual(await hashPassword(null), '');
    });

    it('verifies passwordless shares as true regardless of input', async function () {
      const { verifyPassword } = await getModule();
      assert.strictEqual(await verifyPassword('', ''), true);
      assert.strictEqual(await verifyPassword('anything', ''), true);
      assert.strictEqual(await verifyPassword('', 'somelonghash'), false);
    });
  });

  describe('parseExpiry', function () {
    it('returns 0 for permanent', async function () {
      const { parseExpiry } = await getModule();
      assert.strictEqual(parseExpiry('permanent'), 0);
      assert.strictEqual(parseExpiry('0'), 0);
      assert.strictEqual(parseExpiry(''), 0);
      assert.strictEqual(parseExpiry(null), 0);
    });

    it('parses day units', async function () {
      const { parseExpiry } = await getModule();
      const before = Math.floor(Date.now() / 1000);
      const result = parseExpiry('7d');
      const after = Math.floor(Date.now() / 1000);
      assert.ok(result >= before + 7 * 86400 - 5);
      assert.ok(result <= after + 7 * 86400 + 5);
    });

    it('parses hour units', async function () {
      const { parseExpiry } = await getModule();
      const before = Math.floor(Date.now() / 1000);
      const result = parseExpiry('12h');
      assert.ok(result >= before + 12 * 3600 - 5);
    });

    it('defaults to days for plain number', async function () {
      const { parseExpiry } = await getModule();
      const result = parseExpiry('3');
      const before = Math.floor(Date.now() / 1000);
      assert.ok(result >= before + 3 * 86400 - 5);
    });
  });

  describe('isExpired', function () {
    it('returns false for 0 (never expires)', async function () {
      const { isExpired } = await getModule();
      assert.strictEqual(isExpired(0), false);
    });

    it('returns true for past timestamps', async function () {
      const { isExpired } = await getModule();
      assert.strictEqual(isExpired(Math.floor(Date.now() / 1000) - 100), true);
    });

    it('returns false for future timestamps', async function () {
      const { isExpired } = await getModule();
      assert.strictEqual(isExpired(Math.floor(Date.now() / 1000) + 10000), false);
    });
  });

  describe('KV operations', function () {
    it('stores and retrieves share metadata', async function () {
      const { putShare, getShare, shareKey } = await getModule();
      const kv = createMockKV();
      const meta = {
        path: 'docs/file.txt',
        type: 'file',
        passwordHash: '',
        expiresAt: 0,
        createdAt: 123,
        downloadCount: 0,
      };
      await putShare({ img_url: kv }, 'abc123', meta);
      const retrieved = await getShare({ img_url: kv }, 'abc123');
      assert.strictEqual(retrieved.path, 'docs/file.txt');
      assert.strictEqual(retrieved.type, 'file');
    });

    it('deletes share metadata', async function () {
      const { putShare, getShare, deleteShare } = await getModule();
      const kv = createMockKV();
      await putShare({ img_url: kv }, 'xyz', { path: 'x', type: 'file', passwordHash: '', expiresAt: 0, createdAt: 1 });
      await deleteShare({ img_url: kv }, 'xyz');
      const retrieved = await getShare({ img_url: kv }, 'xyz');
      assert.strictEqual(retrieved, null);
    });

    it('isShareKey identifies share keys', async function () {
      const { isShareKey } = await getModule();
      assert.strictEqual(isShareKey('share:abc123'), true);
      assert.strictEqual(isShareKey('docs/file.txt'), false);
      assert.strictEqual(isShareKey('short:abc'), false);
    });
  });
});
