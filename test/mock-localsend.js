// 临时模拟 LocalSend 设备，用于验证 /api/lan/relay 转发
const http = require('http');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/localsend/v2/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alias: 'Mock Phone', version: '2.1', deviceModel: 'Mock', deviceType: 'mobile', fingerprint: 'mock-fp', download: true }));
  } else if (u.pathname === '/api/localsend/v2/register' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ alias: 'Mock Phone', version: '2.1', deviceModel: 'Mock', deviceType: 'mobile', fingerprint: 'mock-fp', download: true }));
    });
  } else if (u.pathname === '/api/localsend/v2/prepare-upload' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const tokens = {};
      Object.keys(body.files || {}).forEach(id => { tokens[id] = 'tok-' + id.slice(0, 8); });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: 'sess-123', files: tokens }));
    });
  } else if (u.pathname === '/api/localsend/v2/upload' && req.method === 'POST') {
    let n = 0;
    req.on('data', c => n += c.length);
    req.on('end', () => { res.writeHead(200); res.end(); console.log('  mock received upload bytes:', n, 'fileId:', u.searchParams.get('fileId')); });
  } else if (u.pathname === '/api/localsend/v2/prepare-download' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      info: { alias: 'Mock Phone', version: '2.1', deviceModel: 'Mock', deviceType: 'mobile', fingerprint: 'mock-fp', download: true },
      sessionId: 'dl-sess-1',
      files: { 'f-aaa': { id: 'f-aaa', fileName: 'photo.png', size: 12, fileType: 'image/png' } }
    }));
  } else if (u.pathname === '/api/localsend/v2/download' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(Buffer.from('mock-binary!'));
  } else {
    res.writeHead(404); res.end();
  }
});
server.listen(53317, '127.0.0.1', () => console.log('mock localsend on 127.0.0.1:53317'));
