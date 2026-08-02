// End-to-end check of the WebRTC P2P snap transfer page.
//
//   npm start                  # terminal 1 (wrangler pages dev on :8080)
//   npm run test:e2e:snap      # terminal 2
//
// Opens two real browser pages: page A creates a room, page B joins with the
// room code, a real P2P DataChannel is negotiated over the local signaling
// KV, then A sends a file and B must receive identical bytes.
//
// Env: E2E_BASE_URL (default http://localhost:8080), E2E_OUT (screenshot dir).
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Playwright is not installed. Run:\n');
  console.error('  npm install --no-save playwright && npx playwright install chromium\n');
  process.exit(2);
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:8080';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!passed) failures++;
}

(async () => {
  const browser = await chromium.launch();

  // --- two independent pages (sender + receiver) ---
  const pageA = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const pageB = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const jsErrors = [];
  pageA.on('pageerror', (e) => jsErrors.push('A: ' + e.message));
  pageB.on('pageerror', (e) => jsErrors.push('B: ' + e.message));

  // 1. landing UI renders: steps + choices + guide
  await pageA.goto(BASE + '/snap', { waitUntil: 'networkidle' });
  check('步骤指示器渲染', await pageA.locator('#steps li').count() === 3);
  check('入口选项（创建/加入）渲染',
    (await pageA.locator('#btn-create').count()) === 1 && (await pageA.locator('#btn-join').count()) === 1);
  check('三步引导渲染', await pageA.locator('.g-item').count() === 3);

  // 2. join form validation: bad code rejected inline
  await pageA.click('#btn-join');
  await pageA.fill('#join-code', 'abc');
  await pageA.click('#btn-join-go');
  check('非法房间码内联校验', await pageA.locator('#join-error').isVisible());

  // 3. create room on A
  await pageA.goto(BASE + '/snap', { waitUntil: 'networkidle' });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#panel-waiting.show', { timeout: 10000 });
  const shareUrl = await pageA.locator('#share-link').inputValue();
  const codeMatch = shareUrl.match(/room=([A-Za-z0-9]{6})/);
  check('房间创建并生成分享链接', !!codeMatch, shareUrl);
  const code = codeMatch[1];
  check('房间码 6 字符分格显示', (await pageA.locator('#room-code-display .ch').count()) === 6);
  check('TTL 倒计时显示', /有效期 [45]:/.test(await pageA.locator('#ttl-badge').textContent()));

  // 4. B joins via share URL (auto-join path)
  await pageB.goto(shareUrl, { waitUntil: 'networkidle' });

  // 5. both sides reach connected state
  let connected = true;
  try {
    await pageA.waitForSelector('#panel-transfer.show', { timeout: 30000 });
    await pageB.waitForSelector('#panel-transfer.show', { timeout: 30000 });
  } catch (e) {
    connected = false;
  }
  check('双方 P2P 连接建立（30s 内）', connected,
    connected ? '' : 'A: ' + (await pageA.textContent('#status-text')) + ' | B: ' + (await pageB.textContent('#status-text')));
  await pageA.screenshot({ path: path.join(OUT, 'snap-a-connected.png') });
  await pageB.screenshot({ path: path.join(OUT, 'snap-b-connected.png') });

  if (connected) {
    // 6. A sends a file to B
    const payload = crypto.randomBytes(300 * 1024); // 300KB 随机内容
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const testFile = path.join(OUT, 'snap-payload.bin');
    fs.writeFileSync(testFile, payload);

    const downloadPromise = pageB.waitForEvent('download', { timeout: 30000 });
    await pageA.setInputFiles('#file-input', testFile);

    // sender row completes
    await pageA.waitForFunction(() => {
      const st = document.querySelector('#file-list .fstatus');
      return st && st.textContent === '已发送';
    }, { timeout: 30000 });
    check('发送端显示已发送', true);

    // receiver gets the download with identical bytes
    const download = await downloadPromise;
    const savePath = path.join(OUT, 'snap-received.bin');
    await download.saveAs(savePath);
    const received = fs.readFileSync(savePath);
    const receivedHash = crypto.createHash('sha256').update(received).digest('hex');
    check('接收端字节一致（SHA-256）', receivedHash === payloadHash,
      `${received.length}B, hash ${receivedHash.slice(0, 12)}…`);
    check('下载文件名保持', download.suggestedFilename() === 'snap-payload.bin',
      download.suggestedFilename());
    await pageB.screenshot({ path: path.join(OUT, 'snap-b-received.png') });

    // 7. signaling room cleaned up after connect
    const roomRes = await pageA.request.get(BASE + '/api/snap/' + code);
    check('连接后信令房间已清理', roomRes.status() === 404, 'HTTP ' + roomRes.status());
  }

  check('双端无 JS 错误', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | ') || 'none');

  await browser.close();
  console.log(failures ? `\n===== ${failures} 项失败 =====` : '\n===== 全部通过 =====');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('E2E CRASHED:', e); process.exit(2); });
