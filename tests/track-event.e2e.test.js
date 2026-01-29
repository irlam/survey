const { test, expect } = require('@playwright/test');

// Simple smoke test for the server-side analytics ingestion endpoint.
// This verifies the endpoint accepts a JSON event and responds with { ok: true }.

const BASE = process.env.TRACK_EVENT_URL || 'http://127.0.0.1:8000'; // set TRACK_EVENT_URL in CI to target deployed site

test('POST /api/track_event.php accepts an event', async ({ request }) => {
  const payload = {
    event: 'test_event_playwright',
    payload: { test: true, random: Math.random().toString(36).slice(2) }
  };
  const resp = await request.post(`${BASE}/api/track_event.php`, {
    data: payload
  });

  expect(resp.status()).toBeGreaterThanOrEqual(200);
  expect(resp.status()).toBeLessThan(300);
  const body = await resp.json();
  expect(body.ok).toBe(true);
});
