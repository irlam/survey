const { test, expect, describe } = require('@playwright/test');
const { PinDraggable, pxToNorm, normToPx, clamp01 } = require('../app/pin-draggable');

describe('PinDraggable utils', () => {
  test('pxToNorm clamps and converts pixels to normalized [0..1]', () => {
    expect(pxToNorm(0, 100)).toBeCloseTo(0);
    expect(pxToNorm(50, 100)).toBeCloseTo(0.5);
    expect(pxToNorm(100, 100)).toBeCloseTo(1);
    expect(pxToNorm(-10, 100)).toBeCloseTo(0);
    expect(pxToNorm(200, 100)).toBeCloseTo(1);
    // zero total returns center
    expect(pxToNorm(10, 0)).toBeCloseTo(0.5);
  });

  test('normToPx converts normalized to px and clamps', () => {
    expect(normToPx(0, 100)).toBe(0);
    expect(normToPx(0.5, 100)).toBe(50);
    expect(normToPx(1, 100)).toBe(100);
    expect(normToPx(-0.2, 100)).toBe(0);
    expect(normToPx(1.2, 100)).toBe(100);
    expect(PinDraggable.pxToNorm(25, 100)).toBeCloseTo(0.25);
    expect(PinDraggable.normToPx(0.25, 100)).toBe(25);
  });
});
