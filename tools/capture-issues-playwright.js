const fs = require('fs');
(async () => {
  const { chromium } = require('playwright');
  const out = [];
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      const loc = msg.location ? msg.location() : null;
      const locStr = loc && loc.url ? ` (${loc.url}:${loc.lineNumber || 0}:${loc.columnNumber || 0})` : '';
      const text = `[console.${msg.type()}] ${msg.text()}${locStr}`;
      out.push(text);
      console.log(text);
    });
    page.on('pageerror', err => {
      const text = `[pageerror] ${err.toString()}\n${err.stack || ''}`;
      out.push(text);
      console.error(text);
    });
    page.on('response', res => {
      const text = `[response ${res.status()}] ${res.url()}`;
      out.push(text);
      console.log(text);
    });

    const url = 'https://survey.defecttracker.uk/tools/issues.html';
    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Trigger some interactions to surface potential errors
    try {
      await page.evaluate(() => {
        // call loadIssues directly if available
        if (typeof loadIssues === 'function') return 'loadIssues_exists';
        return 'no_loadIssues';
      }).then(r => console.log('loadIssues check ->', r));
    } catch (e) {
      console.warn('loadIssues check failed', e.message || e);
    }

    // Wait more to capture async activity
    await page.waitForTimeout(4000);

    const outPath = './console-capture-issues-playwright.txt';
    fs.writeFileSync(outPath, out.join('\n'));
    console.log('Wrote console capture to', outPath);
  } catch (err) {
    console.error('Playwright capture failed', err);
  } finally {
    await browser.close();
  }
})();