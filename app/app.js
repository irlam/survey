import { renderPlansScreen } from './ui.js';


window.addEventListener('DOMContentLoaded', async () => {
  await renderPlansScreen();
  if (window.startViewer) {
    await window.startViewer(); // binds Add Issue, and loads PDF if ?plan_id= exists
  }
});
