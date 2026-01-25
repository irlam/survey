// dwgviewer-loader.js
// Robust loader for the DWG viewer bundle. Tries direct import, then fetch+repair via blob.
export async function loadDWGBundle(){
  const asset = './assets/main-CM0e8yK0.js';
  try{ 
    const module = await import(asset);
    console.log('module from direct import', module);
    window.AcApDocManager = module.default || module.AcApDocManager;
    console.log('AcApDocManager set to', window.AcApDocManager);
    console.log('Loaded DWG bundle via direct import'); 
    return; 
  }catch(err){ console.warn('Direct import failed', err); }

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

  // If it already contains an export default uB, try transforming it to a window assignment
  let repaired = txt;
  if(/export\s+default\s+uB/.test(txt)){
    console.log('Transforming export default uB() into window.__dwg_bundle assignment');
    repaired = txt.replace(/export\s+default\s+uB\s*\(\s*\)\s*;?/, '\n// Replaced export with window assignment (repaired)\nwindow.__dwg_bundle = uB();');
    // Also handle any stray occurrences
    repaired = repaired.replace(/export\s+default\s+uB/g, 'window.__dwg_bundle = uB');
  } else {
    console.warn('Bundle does not contain export default uB; appending safe assignment');
    repaired = txt + '\n\n// Appended by dwgviewer-loader.js to repair potentially truncated bundle\nwindow.__dwg_bundle = uB();\n';
  }

  try{
    const blob = new Blob([repaired], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try{
      await import(blobUrl);
      window.AcApDocManager = window.__dwg_bundle;
      console.log('Imported repaired bundle via blob URL');
      URL.revokeObjectURL(blobUrl);
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
          await import(blobUrl2);
          window.AcApDocManager = window.__dwg_bundle;
          console.log('Imported trimmed repaired bundle via blob URL');
          URL.revokeObjectURL(blobUrl2);
          return;
        }catch(trimErr){
          console.error('Import of trimmed repaired blob also failed', trimErr);
          try{ URL.revokeObjectURL(blobUrl2); }catch(e){}
          throw trimErr;
        }
      }
      try{ URL.revokeObjectURL(blobUrl); }catch(e){}
      throw blobErr;
    }
  }catch(err){
    console.error('Final repair/import attempt failed', err);
    throw err;
  }
}

// Auto-run when this module is imported (so index.html can just import it)
loadDWGBundle().catch(err=>{ console.error('dwgviewer-loader: failed to load bundle', err); window.dispatchEvent(new CustomEvent('dwgviewer-load-error', { detail: String(err && err.message ? err.message : err) })); });
