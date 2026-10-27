#!/usr/bin/env node
/**
 * Runs tests.html headlessly via Playwright and exits non-zero on any
 * failing assertion. No test framework, no build step — this just loads
 * the real file in a real browser and reads the same #summary element a
 * human sees when opening it directly (see tests.html's own comment).
 *
 * Usage: node scripts/run-tests-headless.js
 * Requires: npx playwright install chromium  (done once in CI, see the
 * workflow file — not committed here since browsers are large binaries).
 */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const fileUrl = 'file://' + path.resolve(__dirname, '..', 'tests.html');
  await page.goto(fileUrl);

  // tests.html's run() is async and sets #summary's text as its last
  // action — wait for non-empty text instead of a fixed timeout, so this
  // doesn't get flaky as the suite grows.
  await page.waitForFunction(
    () => document.getElementById('summary').textContent.trim().length > 0,
    { timeout: 15000 }
  );

  const summary = await page.textContent('#summary');
  const failCount = await page.evaluate(() => document.querySelectorAll('.case.fail').length);

  console.log('\n' + summary);
  if (errors.length) {
    console.log('\nUncaught page errors:');
    errors.forEach((e) => console.log('  - ' + e));
  }

  await browser.close();

  if (failCount > 0 || /crashed/i.test(summary) || errors.length > 0) {
    console.error('\nTest run FAILED.');
    process.exit(1);
  }
  console.log('\nTest run passed.');
  process.exit(0);
})().catch((err) => {
  console.error('Headless runner crashed:', err);
  process.exit(1);
});
