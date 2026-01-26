const { test, expect } = require('@playwright/test');

// NOTE: tests use the live server host used elsewhere in the suite
const BASE = 'https://survey.defecttracker.uk';

test('Export includes pin thumbnail (plan 19 issue 22)', async ({ request }) => {
  // Request the export with debug enabled and include_pin
  const body = 'plan_id=19&issue_id=22&include_pin=1&debug=1';
  const res = await request.post(BASE + '/api/export_report.php', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: body
  });
  expect(res.ok()).toBeTruthy();
  const j = await res.json();
  // Basic sanity checks
  expect(j.ok).toBeTruthy();
  expect(typeof j.pins_included).toBe('number');

  // Assert that at least one pin was included
  expect(j.pins_included).toBeGreaterThan(0);

  // included_pins debug info should be present
  expect(Array.isArray(j.included_pins)).toBeTruthy();
  expect(j.included_pins.length).toBeGreaterThan(0);

  // The generated PDF should be available at the storage URL
  expect(typeof j.filename).toBe('string');
  const pdfUrl = BASE + '/storage/exports/' + encodeURIComponent(j.filename);
  const pdfRes = await request.get(pdfUrl);
  expect(pdfRes.ok()).toBeTruthy();
  const buf = await pdfRes.body();
  // file should be reasonably large
  expect(buf.length).toBeGreaterThan(1024);

  // Optionally: check included pin metadata
  const pin = j.included_pins[0];
  expect(pin.img).toBeTruthy();
  expect(pin.method).toBeTruthy();
});