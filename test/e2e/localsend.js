// End-to-end check of the LocalSend-compatible LAN transfer page.
//
//   npm start                  # terminal 1 (wrangler pages dev on :8080)
//   npm run test:e2e:lan       # terminal 2
//
// The suite spawns a mock LocalSend device (test/mock-localsend.js) on
// 127.0.0.1:53317, then drives /localsend through the real browser flow:
// add device -> pick file -> send (register/prepare-upload/upload via relay),
// and the receive flow (prepare-download/download via relay).
//
// Env: E2E_BASE_URL (default http://localhost:8080), E2E_OUT (screenshot dir).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Playwright is not installed. Run:\n');
  console.error('  npm install --no-save playwright && npx playwright install chromium\n');
  process.exit(2);
}

const BASE = process.env.E2E_BASE_URL || 'http://localhost:8080';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

function waitForMock(retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch('http://127.0.0.1:53317/api/localsend/v2/info')
        .then((r) => (r.ok ? resolve() : attempt(n + 1)))
        .catch(() => {
          if (n >= retries) reject(new Error('mock device did not start'));
          else setTimeout(() => attempt(n + 1), 300);
        });
    };
    attempt(0);
  });
}

(async () => {
  // --- start mock LocalSend device (skip if one is already listening) ---
  let mock = null;
  const alreadyUp = await fetch('http://127.0.0.1:53317/api/localsend/v2/info')
    .then((r) => r.ok).catch(() => false);
  if (alreadyUp) {
    console.log('INFO  检测到 53317 端口已有 LocalSend 模拟设备，复用现有进程');
  } else {
    mock = spawn(process.execPath, [path.join(__dirname, '..', 'mock-localsend.js')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    mock.stdout.on('data', (d) => process.stdout.write('  [mock] ' + d));
    mock.on('error', () => {});
    process.on('exit', () => { try { mock && mock.kill(); } catch (e) {} });
  }

  let failures = 0;
  const check = (name, passed, detail = '') => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    if (!passed) failures++;
  };

  try {
    await waitForMock();

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    // ============ 发送流程 ============
    await page.goto(BASE + '/localsend', { waitUntil: 'networkidle' });
    check('局域网传输页加载', true);

    await page.fill('#device-input', '127.0.0.1:53317');
    await page.click('#btn-add');
    await page.waitForSelector('.dev', { timeout: 10000 });
    const devText = (await page.textContent('.dev')).replace(/\s+/g, ' ');
    check('添加并探测到 LocalSend 设备', /Mock Phone/.test(devText), devText.trim().slice(0, 60));

    const payload = path.join(OUT, 'ls-payload.txt');
    fs.writeFileSync(payload, 'localsend e2e payload ' + Date.now());
    await page.click('.dev');
    await page.setInputFiles('#ls-file-input', payload);
    await page.waitForSelector('#send-file-list .xfile');
    check('文件加入发送队列', true);

    await page.click('#btn-send');
    await page.waitForFunction(() => {
      const t = document.getElementById('send-status-text').textContent;
      return /完成|失败|拒绝|错误/.test(t);
    }, { timeout: 20000 });
    const sendStatus = await page.textContent('#send-status-text');
    const fileStat = await page.textContent('#send-file-list .fstat');
    check('发送完成（register → prepare-upload → upload）',
      /完成/.test(sendStatus) && /已完成/.test(fileStat), sendStatus);
    await page.screenshot({ path: path.join(OUT, 'localsend-send.png'), fullPage: true });

    // ============ 接收流程 ============
    await page.click('#tab-recv');
    await page.fill('#recv-input', '127.0.0.1:53317');
    await page.click('#btn-recv');
    await page.waitForSelector('#recv-list .xfile', { timeout: 10000 });
    const recvName = await page.textContent('#recv-list .fname');
    check('获取设备文件列表（prepare-download）', /photo\.png/.test(recvName), recvName);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#recv-list .dl'),
    ]);
    const savePath = path.join(OUT, 'dl-' + download.suggestedFilename());
    await download.saveAs(savePath);
    const content = fs.readFileSync(savePath).toString();
    check('经中继下载文件内容正确', content === 'mock-binary!', `${content.length} bytes`);
    await page.screenshot({ path: path.join(OUT, 'localsend-recv.png'), fullPage: true });

    check('无 JS 脚本错误', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | ') || 'none');
    await browser.close();
  } catch (e) {
    check('套件执行', false, e.message.split('\n')[0]);
  } finally {
    try { mock && mock.kill(); } catch (e) {}
  }

  console.log(failures ? `\n===== ${failures} 项失败 =====` : '\n===== 全部通过 =====');
  process.exit(failures ? 1 : 0);
})();
