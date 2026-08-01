const assert = require('assert');

describe('webdav-xml utilities', function () {
  async function getModule() {
    return await import('../../functions/utils/webdav-xml.js');
  }

  describe('renderMultistatus', function () {
    it('generates a valid multistatus XML with responses', async function () {
      const { renderMultistatus } = await getModule();
      const entries = [
        {
          href: '/webdav/docs/',
          isCollection: true,
          size: 0,
          lastModified: new Date('2026-07-31T00:00:00Z'),
        },
        {
          href: '/webdav/docs/file.txt',
          isCollection: false,
          size: 1024,
          lastModified: new Date('2026-07-31T00:00:00Z'),
          etag: 'abc',
          contentType: 'text/plain',
        },
      ];
      const xml = renderMultistatus(entries);
      assert.ok(xml.includes('<?xml'));
      assert.ok(xml.includes('<D:multistatus'));
      assert.ok(xml.includes('<D:collection/>'));
      assert.ok(xml.includes('<D:getcontentlength>1024</D:getcontentlength>'));
      assert.ok(xml.includes('<D:getetag>"abc"</D:getetag>'));
      assert.ok(xml.includes('text/plain'));
      assert.ok(xml.includes('/webdav/docs/file.txt'));
    });

    it('escapes XML special characters in hrefs', async function () {
      const { renderMultistatus } = await getModule();
      const xml = renderMultistatus([
        { href: '/webdav/a<b>&c.txt', isCollection: false, size: 0 },
      ]);
      assert.ok(xml.includes('&lt;b&gt;&amp;c.txt'));
      assert.ok(!xml.includes('<b>'));
    });
  });

  describe('parsePropfind', function () {
    it('returns allprop for empty body', async function () {
      const { parsePropfind } = await getModule();
      assert.strictEqual(parsePropfind(''), 'allprop');
      assert.strictEqual(parsePropfind('   '), 'allprop');
    });

    it('returns allprop when allprop is requested', async function () {
      const { parsePropfind } = await getModule();
      const body = '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>';
      assert.strictEqual(parsePropfind(body), 'allprop');
    });

    it('returns propname when propname is requested', async function () {
      const { parsePropfind } = await getModule();
      const body = '<?xml version="1.0"?><propfind xmlns="DAV:"><propname/></propfind>';
      assert.strictEqual(parsePropfind(body), 'propname');
    });

    it('extracts requested properties from prop block', async function () {
      const { parsePropfind } = await getModule();
      const body = `<?xml version="1.0"?>
        <propfind xmlns:D="DAV:">
          <D:prop>
            <D:getcontentlength/>
            <D:getlastmodified/>
          </D:prop>
        </propfind>`;
      const result = parsePropfind(body);
      assert.ok(result instanceof Set);
      assert.ok(result.has('getcontentlength'));
      assert.ok(result.has('getlastmodified'));
    });
  });

  describe('buildWebdavHref', function () {
    it('builds href with mount prefix and encoding', async function () {
      const { buildWebdavHref } = await getModule();
      assert.strictEqual(buildWebdavHref('/webdav', 'docs/file.txt', false), '/webdav/docs/file.txt');
      assert.strictEqual(buildWebdavHref('/webdav', 'docs/sub', true), '/webdav/docs/sub/');
    });

    it('encodes special characters', async function () {
      const { buildWebdavHref } = await getModule();
      const href = buildWebdavHref('/webdav', 'docs/文件 名.txt', false);
      assert.ok(href.includes(encodeURIComponent('文件 名.txt')));
    });

    it('handles empty resource path', async function () {
      const { buildWebdavHref } = await getModule();
      assert.strictEqual(buildWebdavHref('/webdav', '', true), '/webdav/');
    });
  });

  describe('webdavOptionsResponse', function () {
    it('returns 200 with DAV header', async function () {
      const { webdavOptionsResponse } = await getModule();
      const res = webdavOptionsResponse();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('DAV'), '1, 2');
      assert.ok(res.headers.get('Allow').includes('PROPFIND'));
      assert.ok(res.headers.get('Allow').includes('MKCOL'));
    });
  });
});
