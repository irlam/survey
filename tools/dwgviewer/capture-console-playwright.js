const fs = require('fs');
(async () => {
  const { chromium } = require('playwright');
  const out = [];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
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
      const text = `[response ${res.status()}] ${res.url()}`;
      out.push(text);
      console.log(text);
    });

    const url = 'http://localhost:8000';
    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Click sample button to exercise DWG load
    try {
      await page.click('#loadSampleBtn');
      console.log('Clicked loadSampleBtn');
    } catch (e) {
      console.warn('Could not click sample button', e.message || e);
    }
    await page.waitForTimeout(7000);

    // Click PDF export
    try {
      await page.click('#exportPdfBtn');
      console.log('Clicked exportPdfBtn');
    } catch (e) {
      console.warn('Could not click export button', e.message || e);
    }
    await page.waitForTimeout(4000);

    const outPath = './console-capture-playwright.txt';
    fs.writeFileSync(outPath, out.join('\n'));
    console.log('Wrote console capture to', outPath);
  } catch (err) {
    console.error('Playwright capture failed', err);
  } finally {
    await browser.close();
  }
})();