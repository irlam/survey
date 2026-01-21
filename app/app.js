window.addEventListener('DOMContentLoaded', async () => {
  if (window.renderPlansScreen) await window.renderPlansScreen();
  if (window.startViewer) await window.startViewer(); // binds Add Issue, and loads PDF if ?plan_id= exists
});
