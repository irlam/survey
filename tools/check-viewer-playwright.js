(async ()=>{
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args:['--no-sandbox'] });
  try{
    const page = await browser.newPage();
    page.on('console', m => console.log('[console]', m.type(), m.text()));
    page.on('pageerror', e => console.error('[pageerror]', e.stack || e));
    const url = 'https://survey.defecttracker.uk/?plan_id=19';
    console.log('Visiting', url);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    console.log('Done');
  }catch(e){ console.error(e); }
  finally{ await browser.close(); }
})();