(async ()=>{
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args:['--no-sandbox'] });
  try{
    const page = await browser.newPage();
    page.on('console', m => console.log('[console]', m.text()));
    page.on('pageerror', e => console.error('[pageerror]', e.stack || e));
    const url = 'https://survey.defecttracker.uk/';
    console.log('Visiting', url);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle' });
    const fab = await page.$('#fabAddIssue');
    console.log('FAB present?', !!fab);
    if (fab) {
      await page.click('#fabAddIssue');
      await page.waitForTimeout(400);
      const badge = await page.$('#modeBadge');
      const visible = badge ? await badge.isVisible() : false;
      console.log('After click, modeBadge visible?', visible);
    }
  }catch(e){ console.error(e); }
  finally{ await browser.close(); }
})();