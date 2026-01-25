// dwgviewer-loader.js
// Robust loader for the DWG viewer bundle. Tries direct import, then fetch+repair via blob.
export async function loadDWGBundle(){
  const asset = './assets/main-CM0e8yK0.js';
  try{ await import(asset); console.log('Loaded DWG bundle via direct import'); return; }catch(err){ console.warn('Direct import failed', err); }

  // fetch text for diagnostics and potential repair
  let txt = null;
  try{
    const res = await fetch(asset + '?t=' + Date.now(), { cache: 'no-store' });
    txt = await res.text();
    console.log('Fetched DWG bundle text length', txt.length, 'status', res.status);
  }catch(fetchErr){
    console.error('Failed to fetch DWG bundle for diagnostics', fetchErr);
    throw fetchErr;
  }

  // Quick checks
  if(!txt || txt.length < 100){
    throw new Error('Fetched bundle is too short or empty.');
  }
  // If response looks like HTML (e.g., 404 page) bail
  const trimmed = txt.trim();
  if(trimmed.startsWith('<')){
    console.error('Fetched bundle appears to be HTML (likely 404 or error page).');
    console.log('Start of response:', trimmed.slice(0,200));
    throw new Error('Bundle fetch returned HTML or non-js response');
  }

  // If it already contains an export default uB we can try importing via blob as-is
  const hasExport = /export\s+default\s+uB\s*\(/.test(txt) || /export\s+default\s+uB\s*;/.test(txt) || /export\s+default\s+uB\s*\(/.test(txt);
  let repaired = txt;
  if(!hasExport){
    console.warn('Bundle appears to be missing export default uB() - appending for repair.');
    repaired = txt + '\n\n// Appended by dwgviewer-loader.js to repair potentially truncated bundle\nexport default uB();\n';
  }

  try{
    const blob = new Blob([repaired], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try{
      await import(blobUrl + '?t=' + Date.now());
      console.log('Imported repaired bundle via blob URL');
      return;
    }catch(blobErr){
      console.error('Import of repaired blob failed', blobErr);
      // Try trimming anything after the final occurrence of 'export default uB'
      const match = repaired.match(/export\s+default\s+uB[\s\S]*$/m);
      if(match){
        const idx = repaired.lastIndexOf(match[0]);
        const trimmed = repaired.slice(0, idx + match[0].length);
        console.warn('Attempting import of trimmed repaired bundle (cut after export default uB)');
        try{
          const blob2 = new Blob([trimmed], { type: 'application/javascript' });
          const blobUrl2 = URL.createObjectURL(blob2);
          await import(blobUrl2 + '?t=' + Date.now());
          console.log('Imported trimmed repaired bundle via blob URL');
          return;
        }catch(trimErr){
          console.error('Import of trimmed repaired blob also failed', trimErr);
          throw trimErr;
        }
      }
      throw blobErr;
    }
  }catch(err){
    console.error('Final repair/import attempt failed', err);
    throw err;
  }
}

// Auto-run when this module is imported (so index.html can just import it)
loadDWGBundle().catch(err=>{ console.error('dwgviewer-loader: failed to load bundle', err); window.dispatchEvent(new CustomEvent('dwgviewer-load-error', { detail: String(err && err.message ? err.message : err) })); });
