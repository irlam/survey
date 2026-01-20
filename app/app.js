import { renderPlansScreen } from './ui.js';
import { startViewer } from './viewer.js';

window.addEventListener('DOMContentLoaded', async () => {
  await renderPlansScreen();
  await startViewer();
});
