import { renderPlansScreen } from './ui.js';
import { startViewer } from './viewer.js';

window.addEventListener('DOMContentLoaded', async () => {
  await renderPlansScreen();
  await startViewer(); // if ?plan_id=... is present, it loads the PDF
});
