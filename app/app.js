import { renderPlansScreen } from './ui.js';
import { startViewer } from './viewer.js';

window.addEventListener('DOMContentLoaded', async () => {
  await renderPlansScreen();

  // Always bind viewer controls (Add Issue, zoom, etc).
  // If there’s a ?plan_id= in the URL it will also load the PDF.
  await startViewer();
});
