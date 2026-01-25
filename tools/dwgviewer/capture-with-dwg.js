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

    console.log('Navigating to http://localhost:8000');
    await page.goto('http://localhost:8000', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for loader to be ready (dwgviewer-loader import logs show up)
    await page.waitForTimeout(2000);

    // Inspect the global bundle to find initialization helpers
    const bundleInfo = await page.evaluate(() => {
      const b = window.__dwg_bundle || window.AcApDocManager;
      if (!b) return { present: false };
      const proto = Object.getPrototypeOf(b) || {};
      const syms = Object.getOwnPropertySymbols(b || {}).map(s=>s.toString()).slice(0,200);
      return {
        present: true,
        type: typeof b,
        keys: Object.keys(b || {}).slice(0,200),
        ownProps: Object.getOwnPropertyNames(b || {}).slice(0,200),
        symbols: syms,
        protoProps: Object.getOwnPropertyNames(proto).slice(0,200),
        hasCreate: !!(b.createInstance || b.initialize || b.create || b.instance || proto.createInstance),
        str: ('' + b).slice(0,300)
      };
    });
    console.log('Bundle info:', bundleInfo);

    // Fetch DWG in Node (avoids CORS) and pass base64 into page
    const dwgUrl = 'https://download.autodesk.com/us/samplefiles/acad/architectural_-_annotation_scaling_and_multileaders.dwg';
    console.log('Fetching DWG from', dwgUrl);
    const res = await fetch(dwgUrl);
    if (!res.ok) throw new Error('Failed to fetch DWG: ' + res.status + ' ' + res.statusText);
    const arrBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrBuf);
    const b64 = buf.toString('base64');
    console.log('Fetched DWG size bytes', buf.length);

    // Try heuristics: search global values whose source contains clues (createInstance, dwg_read_data, AcApDocManager)
    const heuristics = await page.evaluate(() => {
      const out = [];
      for (const k of Object.getOwnPropertyNames(window)) {
        try {
          const v = window[k];
          const s = '' + v;
          if (s && (s.includes('createInstance') || s.includes('dwg_read_data') || s.includes('AcApDocManager') || s.includes('openDocument'))) {
            out.push(k);
          }
        } catch (e) {}
      }
      return out.slice(0,100);
    });
    console.log('Heuristic matches on window globals:', heuristics);

    // Wait for AcApDocManager.instance to exist in the page
    try {
      await page.waitForFunction(() => window.AcApDocManager && window.AcApDocManager.instance, { timeout: 10000 });
      console.log('AcApDocManager instance ready');
    } catch (e) {
      console.warn('AcApDocManager.instance not ready within timeout, proceeding anyway');
    }

    // Inject the DWG into the page and open it
    const filename = 'architectural_annotation_scaling_and_multileaders.dwg';
    const openResult = await page.evaluate(async (params) => {
      const { b64, filename } = params;
      try {
        const binaryString = atob(b64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        const arrayBuffer = bytes.buffer;
        // Wait for AcApDocManager.instance to become available (poll for up to 10s)
        const waitUntil = Date.now() + 10000;
        while (!(window.AcApDocManager && window.AcApDocManager.instance) && Date.now() < waitUntil) {
          await new Promise(r => setTimeout(r, 200));
        }
        if (!window.AcApDocManager || !window.AcApDocManager.instance) {
          return { ok: false, error: 'Viewer instance not available after wait' };
        }
        await window.AcApDocManager.instance.openDocument(filename, arrayBuffer, { minimumChunkSize: 1000, readOnly: true, mouseControls: false });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    }, { b64, filename });

    console.log('openDocument result:', openResult);

    // Allow time for parser/worker activity
    await page.waitForTimeout(8000);

    const outPath = './console-capture-dwg.txt';
    fs.writeFileSync(outPath, out.join('\n'));
    console.log('Wrote console capture to', outPath);
  } catch (err) {
    console.error('DWG capture failed', err);
  } finally {
    await browser.close();
  }
})();