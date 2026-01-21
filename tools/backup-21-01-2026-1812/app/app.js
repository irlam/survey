import { renderPlansScreen } from './ui.js';
import { startViewer } from './viewer.js?v=20260120_2';

window.addEventListener('DOMContentLoaded', async () => {
  await renderPlansScreen();
  await startViewer(); // binds Add Issue, and loads PDF if ?plan_id= exists
});
