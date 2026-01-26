const { test, expect } = require('@playwright/test');

test('DWG viewer loads without syntax errors', async ({ page }) => {
  // Listen for console messages
  const messages = [];
  const errors = [];
  page.on('console', msg => {
    messages.push(msg.text());
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // Navigate to the DWG viewer
  await page.goto('https://survey.defecttracker.uk/tools/dwgviewer/');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Check for syntax errors
  const syntaxErrors = errors.filter(error => error.includes('SyntaxError'));
  expect(syntaxErrors.length).toBe(0);

  // Check that the loader imported successfully
  const loaderSuccess = messages.some(msg => msg.includes('dwgviewer-loader imported successfully'));
  expect(loaderSuccess).toBe(true);

  // Check that the bundle loaded
  const bundleLoaded = messages.some(msg => msg.includes('Loaded repaired bundle via script tag'));
  expect(bundleLoaded).toBe(true);
});

test('DWG viewer loads sample DWG', async ({ page }) => {
  await page.goto('https://survey.defecttracker.uk/tools/dwgviewer/');

  // Click the sample button
  await page.click('#loadSampleBtn');

  // Wait for the DWG to load
  await page.waitForSelector('#cad-container canvas', { timeout: 30000 });

  // Check that canvas is present
  const canvas = await page.$('#cad-container canvas');
  expect(canvas).not.toBeNull();

  // Check for any errors during loading
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // Wait a bit for processing
  await page.waitForTimeout(5000);

  // Should not have critical errors
  const criticalErrors = errors.filter(error => 
    error.includes('SyntaxError') || 
    error.includes('Failed to load') ||
    error.includes('Viewer not initialized')
  );
  expect(criticalErrors.length).toBe(0);
});