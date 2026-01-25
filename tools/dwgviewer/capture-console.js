const fs = require('fs');
(async () => {
  const puppeteer = require('puppeteer-core');
  const out = [];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      const text = `[console.${msg.type()}] ${msg.text()}`;
      out.push(text);
      console.log(text);
    });
    page.on('pageerror', err => {
      const text = `[pageerror] ${err.toString()}`;
      out.push(text);
      console.error(text);
    });
    page.on('response', res => {
      const url = res.url();
      const status = res.status();
      const text = `[response ${status}] ${url}`;
      out.push(text);
      console.log(text);
    });

    const url = 'http://localhost:8000';
    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait extra time to allow bundle and workers to start
    await page.waitForTimeout(6000);

    // Try clicking sample load and capture after
    try {
      await page.evaluate(() => {
        const btn = document.getElementById('loadSampleBtn');
        if (btn) btn.click();
      });
      await page.waitForTimeout(6000);
    } catch (e) {
      console.warn('Sample click failed', e);
    }

    // Also attempt PDF export to trigger any export-time console output
    try {
      await page.evaluate(() => {
        const btn = document.getElementById('exportPdfBtn');
        if (btn) btn.click();
      });
      await page.waitForTimeout(4000);
    } catch (e) {
      console.warn('Export click failed', e);
    }

    const outputPath = './console-capture.txt';
    fs.writeFileSync(outputPath, out.join('\n'));
    console.log('Wrote console capture to', outputPath);
  } catch (err) {
    console.error('Capture script failed', err);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();