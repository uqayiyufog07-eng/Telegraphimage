const assert = require('assert');

describe('r2-paths utilities', function () {
  async function getModule() {
    return await import('../../functions/utils/r2-paths.js');
  }

  describe('normalizePath', function () {
    it('returns empty for root', async function () {
      const { normalizePath } = await getModule();
      assert.strictEqual(normalizePath(''), '');
      assert.strictEqual(normalizePath('/'), '');
      assert.strictEqual(normalizePath(null), '');
      assert.strictEqual(normalizePath('   '), '');
    });

    it('strips leading slashes and collapses duplicates', async function () {
      const { normalizePath } = await getModule();
      assert.strictEqual(normalizePath('docs'), 'docs');
      assert.strictEqual(normalizePath('/docs/'), 'docs');
      assert.strictEqual(normalizePath('//docs//work//'), 'docs/work');
    });

    it('strips .. and . segments to prevent traversal', async function () {
      const { normalizePath } = await getModule();
      assert.strictEqual(normalizePath('../etc/passwd'), 'etc/passwd');
      assert.strictEqual(normalizePath('docs/../secret'), 'docs/secret');
      assert.strictEqual(normalizePath('./docs/.'), 'docs');
    });
  });

  describe('normalizeDirPrefix', function () {
    it('appends trailing slash for directories', async function () {
      const { normalizeDirPrefix } = await getModule();
      assert.strictEqual(normalizeDirPrefix('docs'), 'docs/');
      assert.strictEqual(normalizeDirPrefix('docs/work'), 'docs/work/');
      assert.strictEqual(normalizeDirPrefix(''), '');
    });
  });

  describe('normalizeFileKey', function () {
    it('produces a clean file key without trailing slash', async function () {
      const { normalizeFileKey } = await getModule();
      assert.strictEqual(normalizeFileKey('docs/report.pdf'), 'docs/report.pdf');
      assert.strictEqual(normalizeFileKey('/docs/report.pdf'), 'docs/report.pdf');
      assert.strictEqual(normalizeFileKey('report.pdf'), 'report.pdf');
      assert.strictEqual(normalizeFileKey(''), '');
    });
  });

  describe('dirname / basename', function () {
    it('extracts directory part', async function () {
      const { dirname } = await getModule();
      assert.strictEqual(dirname('docs/report.pdf'), 'docs');
      assert.strictEqual(dirname('a/b/c.txt'), 'a/b');
      assert.strictEqual(dirname('report.pdf'), '');
      assert.strictEqual(dirname('docs/'), '');
    });

    it('extracts basename', async function () {
      const { basename } = await getModule();
      assert.strictEqual(basename('docs/report.pdf'), 'report.pdf');
      assert.strictEqual(basename('a/b/c.txt'), 'c.txt');
      assert.strictEqual(basename('report.pdf'), 'report.pdf');
      assert.strictEqual(basename('docs/'), 'docs');
      assert.strictEqual(basename(''), '');
    });
  });

  describe('isFolderKey', function () {
    it('detects keys ending with slash', async function () {
      const { isFolderKey } = await getModule();
      assert.strictEqual(isFolderKey('docs/'), true);
      assert.strictEqual(isFolderKey('docs/work/'), true);
      assert.strictEqual(isFolderKey('docs/file.txt'), false);
      assert.strictEqual(isFolderKey(''), false);
    });
  });

  describe('parseListResult', function () {
    it('separates directories and files', async function () {
      const { parseListResult } = await getModule();
      const basePrefix = 'docs/';
      const result = {
        objects: [
          { key: 'docs/readme.md', size: 100 },
          { key: 'docs/', size: 0 },
        ],
        delimitedPrefixes: ['docs/work/', 'docs/photos/'],
      };
      const { directories, files } = parseListResult(result, basePrefix);
      assert.deepStrictEqual(directories, ['work', 'photos']);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].key, 'docs/readme.md');
    });

    it('handles empty results', async function () {
      const { parseListResult } = await getModule();
      const { directories, files } = parseListResult({ objects: [], delimitedPrefixes: [] }, '');
      assert.deepStrictEqual(directories, []);
      assert.deepStrictEqual(files, []);
    });
  });
});
