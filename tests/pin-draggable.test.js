const assert = require('assert');
const { pxToNorm, normToPx, clamp01, PinDraggable } = require('../app/pin-draggable.js');

// Simple unit tests for conversion helpers
assert.strictEqual(pxToNorm(50, 100), 0.5);
assert.strictEqual(pxToNorm(0, 100), 0);
assert.strictEqual(pxToNorm(150, 100), 1); // clamps

assert.strictEqual(normToPx(0.5, 200), 100);
assert.strictEqual(normToPx(-1, 200), 0);
assert.strictEqual(normToPx(2, 200), 200);

console.log('Conversion helper tests passed');

// Basic PinDraggable smoke test (DOM-dependent) - simulate minimal DOM
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="cont" style="width:400px;height:400px;position:relative"><img id="img" src="/test.png" style="width:300px;height:300px;"/></div></body></html>');
global.window = dom.window; global.document = dom.window.document;

const cont = document.getElementById('cont');
const img = document.getElementById('img');

const pd = new PinDraggable({container: cont, img: img, initial: {x_norm:0.3, y_norm:0.6}, onChange: ()=>{}, onSave: ()=>{}});
assert.deepStrictEqual(typeof pd.getCoords().x_norm, 'number');
assert.deepStrictEqual(typeof pd.getCoords().y_norm, 'number');

pd.setCoords({x_norm:0.7, y_norm:0.2});
const c = pd.getCoords();
assert.ok(c.x_norm > 0.69 && c.x_norm < 0.71);
assert.ok(c.y_norm > 0.19 && c.y_norm < 0.21);

pd.destroy();
console.log('PinDraggable smoke tests passed');

console.log('All tests passed');
