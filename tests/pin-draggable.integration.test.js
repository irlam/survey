const assert = require('assert');
const { JSDOM } = require('jsdom');
const { PinDraggable } = require('../app/pin-draggable.js');

// Integration-style test: instantiate PinDraggable on a preview canvas and simulate pointer events
(function(){
  const dom = new JSDOM('<!doctype html><html><body><div id="cont" style="width:220px;height:300px;position:relative"></div></body></html>');
  global.window = dom.window; global.document = dom.window.document;

  const cont = document.getElementById('cont');
  const previewCanvas = document.createElement('canvas'); previewCanvas.width = 200; previewCanvas.height = 300; previewCanvas.style.width = '200px'; previewCanvas.style.height = '300px'; cont.appendChild(previewCanvas);

  let lastCoords = null;
  const pd = new PinDraggable({ container: cont, img: previewCanvas, initial: { x_norm: 0.25, y_norm: 0.25 }, onChange: (coords)=>{ lastCoords = coords; }, onSave: ()=>{} });

  // stub getBoundingClientRect to return predictable values
  pd._getImgRect = ()=>({ left: 0, top: 0, width: 200, height: 300 });

  // stub pointer capture to avoid DOM API missing errors
  pd.pinEl.setPointerCapture = ()=>{};
  pd.pinEl.releasePointerCapture = ()=>{};

  // Simulate pointer down at (50,50) => inside image
  pd._onPointerDown({ preventDefault: ()=>{}, pointerId: 1 });
  // Move to (120, 80)
  pd._onPointerMove({ clientX: 120, clientY: 80, preventDefault: ()=>{} });
  // Release
  pd._onPointerUp({ pointerId: 1, preventDefault: ()=>{} });

  // lastCoords should be set and reflect new normalized coords
  assert.ok(lastCoords, 'onChange/onSave should have been called');
  assert.ok(lastCoords.x_norm > 0.5, 'x_norm should increase after dragging right');
  assert.ok(lastCoords.y_norm > 0.25, 'y_norm should update');

  pd.destroy();
  console.log('PinDraggable integration test passed');
})();