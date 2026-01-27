const { test, expect } = require('@playwright/test');

test('Pin persistence: create/update/delete via API', async ({ request }) => {
  // List plans to find a plan to use
  const lp = await request.get('https://survey.defecttracker.uk/api/list_plans.php');
  const lpJson = await lp.json();
  if (!lpJson || !lpJson.ok || !Array.isArray(lpJson.plans) || lpJson.plans.length === 0) {
    test.skip('No plans available on server to run persistence E2E');
  }
  const plan = lpJson.plans[0];
  const planId = plan.id;

  const uniqueTitle = 'E2E Pin Persist ' + Date.now();
  const initial = { plan_id: planId, page: 1, x_norm: 0.12, y_norm: 0.34, title: uniqueTitle };

  let createdId = null;

  try {
    // Create a new issue
    const createRes = await request.post('https://survey.defecttracker.uk/api/save_issue.php', {
      data: JSON.stringify(initial),
      headers: { 'Content-Type': 'application/json' }
    });
    expect(createRes.status()).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.ok).toBe(true);
    const issue = createJson.issue;
    expect(issue).toBeTruthy();
    createdId = issue.id;
    expect(createdId).toBeGreaterThan(0);
    expect(Number(issue.x_norm)).toBeCloseTo(initial.x_norm, 3);
    expect(Number(issue.y_norm)).toBeCloseTo(initial.y_norm, 3);

    // Verify via list_issues
    const listRes = await request.get(`https://survey.defecttracker.uk/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`);
    const listJson = await listRes.json();
    expect(listJson.ok).toBe(true);
    const found = (listJson.issues || []).find(i => String(i.id) === String(createdId));
    expect(found).toBeTruthy();
    expect(Number(found.x_norm)).toBeCloseTo(initial.x_norm, 3);

    // Update coords (simulate drag/save)
    const updatedCoords = { id: createdId, plan_id: planId, page: 1, x_norm: 0.6, y_norm: 0.4, title: uniqueTitle };
    const updRes = await request.post('https://survey.defecttracker.uk/api/save_issue.php', {
      data: JSON.stringify(updatedCoords),
      headers: { 'Content-Type': 'application/json' }
    });
    expect(updRes.status()).toBe(200);
    const updJson = await updRes.json();
    expect(updJson.ok).toBe(true);
    expect(updJson.updated).toBe(true);

    // Confirm update
    const listRes2 = await request.get(`https://survey.defecttracker.uk/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`);
    const listJson2 = await listRes2.json();
    const found2 = (listJson2.issues || []).find(i => String(i.id) === String(createdId));
    expect(found2).toBeTruthy();
    expect(Number(found2.x_norm)).toBeCloseTo(updatedCoords.x_norm, 3);
    expect(Number(found2.y_norm)).toBeCloseTo(updatedCoords.y_norm, 3);

  } finally {
    if (createdId) {
      // Clean up: delete the created issue
      const delRes = await request.post('https://survey.defecttracker.uk/api/delete_issue.php', {
        data: JSON.stringify({ id: createdId, plan_id: planId }),
        headers: { 'Content-Type': 'application/json' }
      });
      // allow deletion to return 200 OK
      if (delRes.ok()) {
        const delJson = await delRes.json();
        expect(delJson.ok).toBe(true);
        // confirm removed
        const afterList = await request.get(`https://survey.defecttracker.uk/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`);
        const afterJson = await afterList.json();
        const still = (afterJson.issues || []).find(i => String(i.id) === String(createdId));
        expect(still).toBeFalsy();
      }
    }
  }
});