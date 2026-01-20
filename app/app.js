import { renderPlansScreen } from './ui.js';
import { startViewer } from './viewer.js';

function hasPlanId() {
  const u = new URL(window.location.href);
  return u.searchParams.get('plan_id');
}

window.addEventListener('DOMContentLoaded', async () => {
  // Render sidebar (plans list + upload)
  await renderPlansScreen();

  // If a plan is selected in URL, start the viewer
  if (hasPlanId()) {
    await startViewer();
  }
});
