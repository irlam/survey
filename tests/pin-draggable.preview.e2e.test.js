const { test, expect } = require('@playwright/test');

// Ensure render_pin returns an image for an issue after updating its coordinates
test('Pin preview generated after moving a pin', async ({ request }) => {
  const lp = await request.get('https://survey.defecttracker.uk/api/list_plans.php');
  const lpJson = await lp.json();
  if (!lpJson || !lpJson.ok || !Array.isArray(lpJson.plans) || lpJson.plans.length === 0) {
    test.skip('No plans available on server to run E2E');
  }
  const plan = lpJson.plans[0];
  const planId = plan.id;

  const uniqueTitle = 'E2E Pin Preview ' + Date.now();
  const initial = { plan_id: planId, page: 1, x_norm: 0.12, y_norm: 0.34, title: uniqueTitle };

  let createdId = null;

  try {
    const createRes = await request.post('https://survey.defecttracker.uk/api/save_issue.php', {
      data: JSON.stringify(initial),
      headers: { 'Content-Type': 'application/json' }
    });
    expect(createRes.status()).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.ok).toBe(true);
    const issue = createJson.issue;
    createdId = issue.id;

    // Update coords (simulate drag/save)
    const updatedCoords = { id: createdId, plan_id: planId, page: 1, x_norm: 0.6, y_norm: 0.4, title: uniqueTitle };
    const updRes = await request.post('https://survey.defecttracker.uk/api/save_issue.php', {
      data: JSON.stringify(updatedCoords),
      headers: { 'Content-Type': 'application/json' }
    });
    expect(updRes.status()).toBe(200);
    const updJson = await updRes.json();
    expect(updJson.ok).toBe(true);

    // Request pin preview directly
    const pref = await request.get(`https://survey.defecttracker.uk/api/render_pin.php?plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(createdId)}`);
    // render_pin should return PNG
    expect(pref.ok()).toBe(true);
    expect(pref.headers()['content-type']).toMatch(/image/);
  } finally {
    if (createdId) {
      await request.post('https://survey.defecttracker.uk/api/delete_issue.php', {
        data: JSON.stringify({ id: createdId, plan_id: planId }),
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
});
